import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { basename } from 'node:path';
import { Transform } from 'node:stream';

const formatBytes = (value: number) => {
	const units = ['B', 'KB', 'MB', 'GB', 'TB'];
	let size = value;
	let unitIndex = 0;

	while (size >= 1024 && unitIndex < units.length - 1) {
		size /= 1024;
		unitIndex += 1;
	}

	return `${size.toFixed(2)} ${units[unitIndex]}`;
};

export type UploadProgress = {
	elapsedSeconds: number;
	etaSeconds: number | null;
	fileName: string;
	percent: number;
	size: number;
	speedMbps: string;
	uploaded: number;
};

export const getGoogleAccessToken = async ({ allowUnauthenticated = false } = {}) => {
	if (process.env.GOOGLE_ACCESS_TOKEN) {
		console.info('[delivery] using GOOGLE_ACCESS_TOKEN for auth');
		return process.env.GOOGLE_ACCESS_TOKEN;
	}

	const clientId = process.env.GOOGLE_CLIENT_ID;
	const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
	const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;

	if (!clientId || !clientSecret || !refreshToken) {
		if (allowUnauthenticated) {
			console.warn('[delivery] Google auth env vars are missing');
			return null;
		}

		throw new Error(
			'Missing Google OAuth env vars. Required: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN'
		);
	}

	const response = await fetch('https://oauth2.googleapis.com/token', {
		body: new URLSearchParams({
			client_id: clientId,
			client_secret: clientSecret,
			grant_type: 'refresh_token',
			refresh_token: refreshToken,
		}),
		method: 'POST',
	});

	if (!response.ok) {
		const responseText = await response.text();
		if (responseText.includes('invalid_grant')) {
			throw new Error(
				'Google authorization expired or was revoked. The local MP4 is still available. Replace GOOGLE_REFRESH_TOKEN in .env (or remove the Google OAuth values to disable Drive delivery), then restart the app.'
			);
		}
		throw new Error(`Google token refresh failed: ${responseText}`);
	}

	const data = await response.json();

	if (!data.access_token) {
		throw new Error(`No access token returned: ${JSON.stringify(data)}`);
	}

	return data.access_token as string;
};

export type DriveUploadResult = {
	driveConfigured: boolean;
	driveLink: string;
	driveName: string;
	fileId: string | null;
	publicUrl: string;
};

export async function uploadToDrive(
	filePath: string,
	{
		onProgress,
		allowUnauthenticated = false,
		shareAnyone = process.env.GOOGLE_DRIVE_SHARE_ANYONE === 'true',
	}: {
		onProgress?: (progress: UploadProgress) => void;
		allowUnauthenticated?: boolean;
		shareAnyone?: boolean;
	} = {}
): Promise<DriveUploadResult> {
	const accessToken = await getGoogleAccessToken({ allowUnauthenticated });
	const fileName = basename(filePath);
	const { size } = await stat(filePath);

	console.info('[delivery] upload requested', {
		fileName,
		fileSizeBytes: size,
		driveFolderIdConfigured: Boolean(process.env.GOOGLE_DRIVE_FOLDER_ID),
		shareAnyone: process.env.GOOGLE_DRIVE_SHARE_ANYONE === 'true',
	});

	if (!accessToken) {
		console.warn('[delivery] upload skipped because no Google access token is available');
		return {
			driveConfigured: false,
			driveLink: filePath,
			driveName: fileName,
			fileId: null,
			publicUrl: filePath,
		};
	}

	if (!size) {
		throw new Error('File size is 0 bytes. Nothing to upload.');
	}

	const metadata = {
		name: fileName,
		mimeType: 'video/mp4',
		...(process.env.GOOGLE_DRIVE_FOLDER_ID ? { parents: [process.env.GOOGLE_DRIVE_FOLDER_ID] } : {}),
	};

	const sessionResponse = await fetch(
		'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,name,webViewLink,webContentLink',
		{
			body: JSON.stringify(metadata),
			headers: {
				Authorization: `Bearer ${accessToken}`,
				'Content-Type': 'application/json; charset=UTF-8',
				'X-Upload-Content-Length': String(size),
				'X-Upload-Content-Type': 'video/mp4',
			},
			method: 'POST',
		}
	);

	if (!sessionResponse.ok) {
		console.error('[delivery] Drive upload session failed', {
			fileName,
			status: sessionResponse.status,
		});
		throw new Error(`Upload session failed: ${await sessionResponse.text()}`);
	}

	const uploadUrl = sessionResponse.headers.get('location');

	if (!uploadUrl) {
		throw new Error('Missing resumable upload URL from Google Drive.');
	}
	console.info('[delivery] resumable upload session created', { fileName });

	const startTime = Date.now();
	let uploaded = 0;

	const progressStream = new Transform({
		transform(chunk, encoding, callback) {
			uploaded += chunk.length;

			const elapsedSeconds = Math.max((Date.now() - startTime) / 1000, 0.001);
			const percent = (uploaded / size) * 100;
			const speedMbps = ((uploaded * 8) / elapsedSeconds / 1024 / 1024).toFixed(2);
			const remainingBytes = size - uploaded;
			const bytesPerSecond = uploaded / elapsedSeconds;
			const etaSeconds = bytesPerSecond > 0 ? Math.ceil(remainingBytes / bytesPerSecond) : null;

			onProgress?.({
				elapsedSeconds,
				etaSeconds,
				fileName,
				percent,
				size,
				speedMbps,
				uploaded,
			});

			callback(null, chunk);
		},
	});

	const uploadResponse = await fetch(uploadUrl, {
		body: createReadStream(filePath).pipe(progressStream) as unknown as BodyInit,
		duplex: 'half',
		headers: {
			'Content-Length': String(size),
			'Content-Type': 'video/mp4',
		},
		method: 'PUT',
	} as RequestInit & { duplex: 'half' });

	if (!uploadResponse.ok) {
		console.error('[delivery] Drive upload failed', {
			fileName,
			status: uploadResponse.status,
		});
		throw new Error(`Drive upload failed: ${await uploadResponse.text()}`);
	}

	const file = (await uploadResponse.json()) as {
		id: string;
		name: string;
		webContentLink?: string;
		webViewLink?: string;
	};

	if (shareAnyone) {
		console.info('[delivery] granting anyone-with-link access', { fileId: file.id });
		const permissionResponse = await fetch(`https://www.googleapis.com/drive/v3/files/${file.id}/permissions`, {
			body: JSON.stringify({
				role: 'reader',
				type: 'anyone',
			}),
			headers: {
				Authorization: `Bearer ${accessToken}`,
				'Content-Type': 'application/json',
			},
			method: 'POST',
		});

		if (!permissionResponse.ok) {
			console.error('[delivery] Drive permission update failed', {
				fileId: file.id,
				status: permissionResponse.status,
			});
			throw new Error(`Permission update failed: ${await permissionResponse.text()}`);
		}
	}

	return {
		driveConfigured: true,
		driveLink: file.webViewLink ?? file.webContentLink ?? `https://drive.google.com/file/d/${file.id}/view`,
		driveName: file.name,
		fileId: file.id,
		publicUrl: `https://drive.google.com/file/d/${file.id}/view`,
	};
}

const toBase64Url = (value: string) =>
	Buffer.from(value).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');

export type RenderDelivery = {
	driveConfigured: boolean;
	driveLink: string;
	driveName: string;
	driveSizeLabel?: string;
	emailConfigured: boolean;
	emailSent: boolean;
	emailTo?: string;
	fileId: string | null;
	publicUrl: string;
	status: 'local' | 'uploaded' | 'emailed' | 'partial' | 'failed';
	driveError?: string;
	emailError?: string;
};

export const deliverRender = async ({
	email,
	filePath,
	onProgress,
}: {
	email?: string;
	filePath: string;
	onProgress?: (progress: UploadProgress) => void;
}): Promise<RenderDelivery> => {
	const baseDelivery: RenderDelivery = {
		driveConfigured: false,
		driveLink: filePath,
		driveName: basename(filePath),
		emailConfigured: false,
		emailSent: false,
		fileId: null,
		publicUrl: filePath,
		status: 'local',
	};

	let driveResult: DriveUploadResult | null = null;

	try {
		console.info('[delivery] starting upload stage', { filePath });
		driveResult = await uploadToDrive(filePath, {
			allowUnauthenticated: true,
			onProgress,
		});
	} catch (error) {
		console.error('[delivery] upload stage failed', error);
		return {
			...baseDelivery,
			status: 'failed',
			driveError: error instanceof Error ? error.message : String(error),
		};
	}

	const delivery: RenderDelivery = {
		...baseDelivery,
		driveConfigured: driveResult.driveConfigured,
		driveLink: driveResult.driveLink,
		driveName: driveResult.driveName,
		fileId: driveResult.fileId,
		publicUrl: driveResult.publicUrl,
		status: driveResult.driveConfigured ? 'uploaded' : 'local',
	};

	if (!email?.trim()) {
		console.info('[delivery] no recipient email provided; upload only');
		return delivery;
	}

	const accessToken = await getGoogleAccessToken({ allowUnauthenticated: true });

	if (!accessToken || !process.env.GMAIL_FROM) {
		console.warn('[delivery] email skipped because Gmail auth or sender config is missing');
		return {
			...delivery,
			emailConfigured: false,
			emailTo: email.trim(),
			status: delivery.driveConfigured ? 'uploaded' : 'local',
		};
	}

	const messageLines = [
		`From: ${process.env.GMAIL_FROM}`,
		`To: ${email.trim()}`,
		`Subject: Your video render is ready: ${driveResult.driveName}`,
		'Content-Type: text/plain; charset=UTF-8',
		'',
		'Your render is complete.',
		'',
		process.env.GOOGLE_DRIVE_FOLDER_ID
			? `Drive folder: https://drive.google.com/drive/folders/${process.env.GOOGLE_DRIVE_FOLDER_ID}`
			: null,
		`Drive link: ${driveResult.driveLink}`,
		`File name: ${driveResult.driveName}`,
		`File size: ${formatBytes((await stat(filePath)).size)}`,
		`Render file: ${filePath}`,
	]
		.filter((line): line is string => line !== null)
		.join('\r\n');

	const response = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
		body: JSON.stringify({ raw: toBase64Url(messageLines) }),
		headers: {
			Authorization: `Bearer ${accessToken}`,
			'Content-Type': 'application/json',
		},
		method: 'POST',
	});

	if (!response.ok) {
		console.error('[delivery] Gmail send failed', {
			status: response.status,
			email: email.trim(),
		});
		return {
			...delivery,
			emailConfigured: true,
			emailTo: email.trim(),
			emailError: await response.text(),
			status: delivery.driveConfigured ? 'partial' : 'failed',
		};
	}

	return {
		...delivery,
		emailConfigured: true,
		emailSent: true,
		emailTo: email.trim(),
		status: 'emailed',
	};
};
