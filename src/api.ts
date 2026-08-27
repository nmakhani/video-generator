import type { ProjectDocument, JobManifest } from './shared/schemas';
import type { TranscriptPage } from './video/types';

export type VideoSummary = {
	slug: string;
	sizeBytes: number;
	updatedAt: string;
	hasPreview: boolean;
	hasAudio: boolean;
	hasCaptions: boolean;
	hasTokens: boolean;
	previewUrl: string;
};
export type VideoDetail = VideoSummary & {
	captionText: string;
	transcriptPages: TranscriptPage[];
	activeJob: JobManifest | null;
};
export type ProjectSummary = ProjectDocument & { slug: string; updatedAt: string };
export type RenderSummary = JobManifest & { downloadUrl?: string };
export type UploadProgress = {
	loaded: number;
	total: number;
	percent: number;
};

export const request = async <T>(url: string, options?: RequestInit): Promise<T> => {
	const response = await fetch(url, options);
	if (!response.ok) {
		const payload = (await response.json().catch(() => ({}))) as { error?: { message?: string } };
		throw new Error(payload.error?.message || `Request failed (${response.status}).`);
	}
	if (response.status === 204) return undefined as T;
	return response.json() as Promise<T>;
};

const parseUploadError = (status: number, responseText: string) => {
	try {
		const payload = responseText ? (JSON.parse(responseText) as { error?: { message?: string } }) : {};
		return new Error(payload.error?.message || `Request failed (${status}).`);
	} catch {
		return new Error(`Request failed (${status}).`);
	}
};

export const uploadRequest = async <T>(
	url: string,
	options: { body: FormData; method?: string; onProgress?: (progress: UploadProgress) => void }
): Promise<T> =>
	new Promise<T>((resolve, reject) => {
		const xhr = new XMLHttpRequest();
		xhr.open(options.method || 'POST', url);
		xhr.responseType = 'text';
		xhr.upload.onprogress = (event) => {
			if (!options.onProgress) return;
			const total = event.lengthComputable ? event.total : 0;
			const percent = total > 0 ? event.loaded / total : 0;
			options.onProgress({ loaded: event.loaded, total, percent });
		};
		xhr.onerror = () => reject(new Error('Upload failed.'));
		xhr.onabort = () => reject(new Error('Upload canceled.'));
		xhr.onload = () => {
			try {
				if (xhr.status < 200 || xhr.status >= 300) {
					throw parseUploadError(xhr.status, xhr.responseText);
				}
				if (xhr.status === 204 || !xhr.responseText) {
					resolve(undefined as T);
					return;
				}
				resolve(JSON.parse(xhr.responseText) as T);
			} catch (error) {
				reject(error instanceof Error ? error : new Error(String(error)));
			}
		};
		xhr.send(options.body);
	});

export const jsonOptions = (method: string, body?: unknown): RequestInit => ({
	method,
	headers: { 'Content-Type': 'application/json' },
	...(body === undefined ? {} : { body: JSON.stringify(body) }),
});
export const slugify = (value: string) =>
	value
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-|-$/g, '')
		.replace(/-+/g, '-');
