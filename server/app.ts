import { spawn } from 'node:child_process';
import { mkdir, readFile, rename, rm, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import express, { type NextFunction, type Request, type Response } from 'express';
import multer from 'multer';
import { createDefaultProject } from '../src/shared/defaults';
import {
	captionEditRequestSchema,
	pipelineRequestSchema,
	projectDocumentSchema,
	renderRequestSchema,
	slugSchema,
	videoSlugFromFolder,
	type JobManifest,
} from '../src/shared/schemas';
import {
	createProject,
	ensureDataDirectories,
	exists,
	listProjects,
	listVideos,
	projectFile,
	readProject,
	removeProject,
	removeVideo,
	updateProject,
	videoDirectory,
	videoPaths,
} from './fs-store';
import { JobQueue } from './jobs';
import { getCaptionText, runCaptionPipeline, updateCaptionText, verifyVideo } from './pipeline';
import { runRender } from './render';
import { ROOT, UPLOADS } from './paths';

type AppError = Error & { code?: string; status?: number; details?: unknown };
const asyncRoute =
	(handler: (req: Request, res: Response, next: NextFunction) => Promise<void>) =>
	(req: Request, res: Response, next: NextFunction) =>
		void handler(req, res, next).catch(next);

const sendMedia = async (
	req: Request,
	res: Response,
	target: string,
	downloadName?: string,
	contentType = 'video/mp4'
) => {
	const fileStats = await stat(target);
	const match = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
	if (req.headers.range && !match) {
		res.status(416).set('Content-Range', `bytes */${fileStats.size}`).end();
		return;
	}
	const headers: Record<string, string | number> = {
		'Accept-Ranges': 'bytes',
		'Cache-Control': 'public, max-age=31536000, immutable',
		'Content-Type': contentType,
		'X-Content-Type-Options': 'nosniff',
	};
	if (downloadName) headers['Content-Disposition'] = `attachment; filename="${downloadName}"`;
	if (match) {
		const start = match[1] ? Number(match[1]) : Math.max(fileStats.size - Number(match[2]), 0);
		const end = match[2] && match[1] ? Number(match[2]) : fileStats.size - 1;
		if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end >= fileStats.size || start > end) {
			res.status(416).set('Content-Range', `bytes */${fileStats.size}`).end();
			return;
		}
		res.status(206).set({
			...headers,
			'Content-Range': `bytes ${start}-${end}/${fileStats.size}`,
			'Content-Length': end - start + 1,
		});
		const { createReadStream } = await import('node:fs');
		createReadStream(target, { start, end }).pipe(res);
		return;
	}
	res.status(200).set({ ...headers, 'Content-Length': fileStats.size });
	const { createReadStream } = await import('node:fs');
	createReadStream(target).pipe(res);
};

const checkCommand = (command: string) =>
	new Promise<boolean>((done) => {
		const child = spawn(command, ['-version'], { stdio: 'ignore', shell: false });
		let settled = false;
		const finish = (available: boolean) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			done(available);
		};
		const timer = setTimeout(() => {
			child.kill();
			finish(false);
		}, 2000);
		child.once('error', () => finish(false));
		child.once('close', (code) => finish(code === 0));
	});

export const createApplication = async ({ autoStartJobs = true }: { autoStartJobs?: boolean } = {}) => {
	await ensureDataDirectories();
	const processor = async (job: JobManifest, update: (patch: Partial<JobManifest>) => Promise<void>) =>
		job.kind === 'caption-pipeline' ? runCaptionPipeline(job, update) : runRender(job, update);
	const jobs = new JobQueue(processor, autoStartJobs);
	await jobs.initialize();
	const app = express();
	app.use(express.json({ limit: '4mb' }));

	const upload = multer({
		dest: UPLOADS,
		limits: { fileSize: Number(process.env.UPLOAD_MAX_BYTES || 1024 ** 3), files: 1 },
		fileFilter: (_req, file, callback) =>
			callback(
				null,
				file.originalname.toLowerCase().endsWith('.mp4') &&
					['video/mp4', 'application/octet-stream'].includes(file.mimetype)
			),
	});

	app.get(
		'/api/health',
		asyncRoute(async (_req, res) => {
			res.json({ ok: true, ffmpeg: await checkCommand('ffmpeg'), ffprobe: await checkCommand('ffprobe') });
		})
	);
	app.get(
		'/api/videos',
		asyncRoute(async (_req, res) => {
			res.json(await listVideos());
		})
	);
	app.post(
		'/api/videos',
		upload.single('video'),
		asyncRoute(async (req, res) => {
			const temporary = req.file?.path;
			try {
				if (!req.file || !temporary)
					throw Object.assign(new Error('Choose an MP4 file.'), { code: 'VIDEO_REQUIRED', status: 400 });
				const slug = slugSchema.parse(req.body.slug);
				const paths = videoPaths(slug);
				if (await exists(paths.dir))
					throw Object.assign(new Error('A video with this slug already exists.'), {
						code: 'VIDEO_EXISTS',
						status: 409,
					});
				if (req.file.size === 0)
					throw Object.assign(new Error('The uploaded video is empty.'), { code: 'EMPTY_VIDEO', status: 400 });
				await verifyVideo(temporary);
				await mkdir(videoDirectory(slug), { recursive: false });
				await rename(temporary, paths.video);
				void jobs
					.enqueue({ kind: 'caption-pipeline', videoSlug: slug, action: 'preview', force: true })
					.catch((error) => console.warn('[videos] could not enqueue preview generation', { slug, error }));
				res.status(201).json({ slug, previewUrl: `/api/videos/${encodeURIComponent(slug)}/file` });
			} finally {
				if (temporary) await rm(temporary, { force: true });
			}
		})
	);
	app.get(
		'/api/videos/:slug',
		asyncRoute(async (req, res) => {
			const slug = slugSchema.parse(req.params.slug);
			const paths = videoPaths(slug);
			if (!(await exists(paths.video)))
				throw Object.assign(new Error('Video not found.'), { code: 'VIDEO_NOT_FOUND', status: 404 });
			const all = await listVideos();
			const summary = all.find((item) => item.slug === slug);
			const transcriptPages = (await exists(paths.tokens)) ? JSON.parse(await readFile(paths.tokens, 'utf8')) : [];
			const captionText = (await exists(paths.captions)) ? await getCaptionText(slug) : '';
			const activeJob = (await jobs.listActive()).find((job) => job.videoSlug === slug) || null;
			res.json({ ...summary, captionText, transcriptPages, activeJob });
		})
	);
	app.put(
		'/api/videos/:slug/captions',
		asyncRoute(async (req, res) => {
			const slug = slugSchema.parse(req.params.slug);
			if (!(await exists(videoPaths(slug).video)))
				throw Object.assign(new Error('Video not found.'), { code: 'VIDEO_NOT_FOUND', status: 404 });
			const payload = captionEditRequestSchema.parse(req.body);
			res.json(await updateCaptionText(slug, payload.text));
		})
	);
	app.get(
		'/api/videos/:slug/file',
		asyncRoute(async (req, res) => {
			await sendMedia(req, res, videoPaths(slugSchema.parse(req.params.slug)).video);
		})
	);
	app.get(
		'/api/videos/:slug/preview',
		asyncRoute(async (req, res) => {
			const paths = videoPaths(slugSchema.parse(req.params.slug));
			if (!(await exists(paths.preview)))
				throw Object.assign(new Error('Preview video not found.'), { code: 'PREVIEW_NOT_FOUND', status: 404 });
			await sendMedia(req, res, paths.preview);
		})
	);
	app.get(
		'/api/videos/:slug/audio',
		asyncRoute(async (req, res) => {
			const paths = videoPaths(slugSchema.parse(req.params.slug));
			if (!(await exists(paths.audio)))
				throw Object.assign(new Error('Audio not found.'), { code: 'AUDIO_NOT_FOUND', status: 404 });
			await sendMedia(req, res, paths.audio, undefined, 'audio/wav');
		})
	);
	app.post(
		'/api/videos/:slug/pipeline',
		asyncRoute(async (req, res) => {
			const slug = slugSchema.parse(req.params.slug);
			if (!(await exists(videoPaths(slug).video)))
				throw Object.assign(new Error('Video not found.'), { code: 'VIDEO_NOT_FOUND', status: 404 });
			const payload = pipelineRequestSchema.parse(req.body);
			const job = await jobs.enqueue({
				kind: 'caption-pipeline',
				videoSlug: slug,
				action: payload.action,
				force: payload.force,
			});
			res.status(202).json(job);
		})
	);
	app.delete(
		'/api/videos/:slug',
		asyncRoute(async (req, res) => {
			await removeVideo(slugSchema.parse(req.params.slug));
			res.status(204).end();
		})
	);

	app.get(
		'/api/projects',
		asyncRoute(async (_req, res) => {
			res.json(await listProjects());
		})
	);
	app.post(
		'/api/projects',
		asyncRoute(async (req, res) => {
			const slug = slugSchema.parse(req.body.slug);
			const document = req.body.document
				? projectDocumentSchema.parse(req.body.document)
				: createDefaultProject(String(req.body.name || slug));
			await createProject(slug, document);
			res.status(201).json({ slug, ...document });
		})
	);
	app.get(
		'/api/projects/:slug',
		asyncRoute(async (req, res) => {
			const slug = slugSchema.parse(req.params.slug);
			res.json({ slug, ...(await readProject(slug)) });
		})
	);
	app.put(
		'/api/projects/:slug',
		asyncRoute(async (req, res) => {
			const slug = slugSchema.parse(req.params.slug);
			const nextSlug = slugSchema.parse(req.body.slug || slug);
			const document = projectDocumentSchema.parse(req.body.document);
			res.json(await updateProject(slug, nextSlug, document));
		})
	);
	app.delete(
		'/api/projects/:slug',
		asyncRoute(async (req, res) => {
			await removeProject(slugSchema.parse(req.params.slug));
			res.status(204).end();
		})
	);
	app.post(
		'/api/projects/:slug/render',
		asyncRoute(async (req, res) => {
			const slug = slugSchema.parse(req.params.slug);
			const project = await readProject(slug);
			if (project.template.videoBased && !(videoSlugFromFolder(project.template.videoFolder) ?? project.videoSlug))
				throw Object.assign(new Error('Select a source video before rendering.'), {
					code: 'VIDEO_REQUIRED',
					status: 400,
				});
			const payload = renderRequestSchema.parse(req.body || {});
			const recipientEmail =
				typeof payload.email === 'string' && payload.email.trim() ? payload.email.trim() : undefined;
			const job = await jobs.enqueue({ kind: 'render', projectSlug: slug, recipientEmail });
			console.info('[render] queued job', {
				id: job.id,
				projectSlug: slug,
				recipientEmail: recipientEmail ?? null,
			});
			res.status(202).json(job);
		})
	);
	app.get(
		'/api/renders',
		asyncRoute(async (_req, res) => {
			const renders = await jobs.listByKind('render');
			res.json(
				renders.map((job) => ({
					...job,
					...(job.status === 'completed' && job.outputPath ? { downloadUrl: `/api/renders/${job.id}/file` } : {}),
				}))
			);
		})
	);

	app.get(
		'/api/jobs/:id',
		asyncRoute(async (req, res) => {
			const job = await jobs.get(String(req.params.id));
			if (!job) throw Object.assign(new Error('Job not found.'), { code: 'JOB_NOT_FOUND', status: 404 });
			res.json({
				...job,
				...(job.kind === 'render' && job.status === 'completed' ? { downloadUrl: `/api/renders/${job.id}/file` } : {}),
			});
		})
	);
	app.get(
		'/api/renders/:id/file',
		asyncRoute(async (req, res) => {
			const job = await jobs.get(String(req.params.id));
			if (!job?.outputPath || job.status !== 'completed')
				throw Object.assign(new Error('Render not found.'), { code: 'RENDER_NOT_FOUND', status: 404 });
			await sendMedia(req, res, job.outputPath, `${job.projectSlug || 'render'}.mp4`);
		})
	);

	const dist = resolve(ROOT, 'dist');
	app.use(express.static(dist));
	app.use((req, res, next) => {
		if (req.method !== 'GET' || req.path.startsWith('/api/')) return next();
		void readFile(resolve(dist, 'index.html'), 'utf8')
			.then((html) => res.type('html').send(html))
			.catch(next);
	});
	app.use((error: AppError, _req: Request, res: Response, _next: NextFunction) => {
		const zodIssues = 'issues' in error ? (error as unknown as { issues: unknown }).issues : undefined;
		res.status(error.status || (zodIssues ? 400 : 500)).json({
			error: {
				code: error.code || (zodIssues ? 'VALIDATION_ERROR' : 'INTERNAL_ERROR'),
				message: error.message || 'Request failed.',
				details: error.details || zodIssues,
			},
		});
	});
	return { app, jobs };
};
