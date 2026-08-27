import { Player, type PlayerRef } from '@remotion/player';
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { JsonPanel } from '../builder/JsonPanel';
import { LayoutPreview } from '../builder/LayoutPreview';
import { SegmentEditor } from '../builder/SegmentEditor';
import { ThemeEditor } from '../builder/ThemeEditor';
import { newSegment, toFormSegment, toTemplate } from '../builder/templateMapper';
import type { FormSegment } from '../builder/types';
import { jsonOptions, request, slugify, type VideoDetail, type VideoSummary } from '../api';
import {
	FPS,
	LAYOUT_SPECS,
	VIDEO_HEIGHT,
	VIDEO_WIDTH,
	defaultTheme,
	getSegmentDurationInFrames,
	getTemplateDurationInFrames,
	type InfographicTemplate,
	type LayoutKind,
	type Theme,
} from '../layoutCatalog';
import {
	templateSchema,
	videoFolderForSlug,
	videoSlugFromFolder,
	type JobManifest,
	type ProjectDocument,
} from '../shared/schemas';
import { button, errorNotice, eyebrow, field, fieldLabel, input, notice, panel, secondaryButton } from '../ui';
import { InfographicVideo } from '../video/InfographicVideo';
import type { TranscriptPage } from '../video/types';

type ProjectPayload = ProjectDocument & { slug: string };
type RenderJob = JobManifest & { downloadUrl?: string };
type PreviewQuality = '5' | '10' | '20' | '30';

const previewQualityOptions: Record<PreviewQuality, { fps: number; label: string }> = {
	'5': { fps: 5, label: '5' },
	'10': { fps: 10, label: '10' },
	'20': { fps: 20, label: '20' },
	'30': { fps: 30, label: '30' },
};

const formSegments = (template: InfographicTemplate): FormSegment[] =>
	template.segments.map((segment) => ({
		...toFormSegment(segment),
		videoShown: template.videoBased === true && segment.videoShown === true,
	}));

export const ProjectEditorPage = () => {
	const { slug = '' } = useParams();
	const navigate = useNavigate();
	const [loaded, setLoaded] = useState(false);
	const [error, setError] = useState('');
	const [message, setMessage] = useState('');
	const [name, setName] = useState('');
	const [slugDraft, setSlugDraft] = useState(slug);
	const [videoSlug, setVideoSlug] = useState<string | null>(null);
	const [title, setTitle] = useState('');
	const [hookText, setHookText] = useState('');
	const [intro, setIntro] = useState(true);
	const [outro, setOutro] = useState(true);
	const [videoBased, setVideoBased] = useState(false);
	const [caption, setCaption] = useState(false);
	const [theme, setTheme] = useState<Theme>({ ...defaultTheme });
	const [segments, setSegments] = useState<FormSegment[]>([]);
	const [videos, setVideos] = useState<VideoSummary[]>([]);
	const [tokens, setTokens] = useState<TranscriptPage[]>([]);
	const [tokensLoaded, setTokensLoaded] = useState(false);
	const [tokensError, setTokensError] = useState('');
	const [jsonDraft, setJsonDraft] = useState('');
	const [jsonError, setJsonError] = useState<string | null>(null);
	const [copied, setCopied] = useState(false);
	const [renderJob, setRenderJob] = useState<RenderJob | null>(null);
	const [renderStatus, setRenderStatus] = useState<'idle' | 'submitting' | 'error'>('idle');
	const [renderError, setRenderError] = useState('');
	const [deliveryWarning, setDeliveryWarning] = useState('');
	const [notificationEmail, setNotificationEmail] = useState('');
	const [previewQuality, setPreviewQuality] = useState<PreviewQuality>('30');
	const [previewStartFrame, setPreviewStartFrame] = useState(0);
	const previewPlayerRef = useRef<PlayerRef>(null);
	const previewSectionRef = useRef<HTMLElement | null>(null);

	const template = useMemo(
		() =>
			toTemplate(
				title,
				hookText,
				intro,
				outro,
				caption,
				theme,
				videoBased,
				segments,
				videoSlug ? videoFolderForSlug(videoSlug) : undefined
			),
		[title, hookText, intro, outro, caption, theme, videoBased, segments, videoSlug]
	);
	const durationInFrames = useMemo(() => getTemplateDurationInFrames(template, FPS), [template]);
	const previewFps = previewQualityOptions[previewQuality].fps;
	const deferredTemplate = useDeferredValue(template);
	const segmentRanges = useMemo(() => {
		let cursor = 0;

		return template.segments.map((segment) => {
			const startFrame = cursor;
			const durationInFrames = getSegmentDurationInFrames(segment, FPS);
			cursor += durationInFrames;

			return {
				endFrame: cursor,
				startFrame,
			};
		});
	}, [template]);
	const previewDurationInFrames = useMemo(
		() => getTemplateDurationInFrames(deferredTemplate, previewFps),
		[deferredTemplate, previewFps]
	);
	const toPreviewFrame = useCallback(
		(frame: number) => {
			const frameAtPreviewFps = Math.round((frame / FPS) * previewFps);

			return Math.max(0, Math.min(frameAtPreviewFps, Math.max(0, previewDurationInFrames - 1)));
		},
		[previewDurationInFrames, previewFps]
	);
	const previewInitialFrame = useMemo(() => toPreviewFrame(previewStartFrame), [previewStartFrame, toPreviewFrame]);
	const deferredTokens = useDeferredValue(tokens);
	const selectedVideo = useMemo(() => videos.find((video) => video.slug === videoSlug) ?? null, [videos, videoSlug]);
	const previewVideoSrc =
		selectedVideo?.previewUrl ?? (videoSlug ? `/api/videos/${encodeURIComponent(videoSlug)}/file` : undefined);
	const deferredPreviewVideoSrc = useDeferredValue(previewVideoSrc);
	const previewInputProps = useMemo(
		() => ({
			template: deferredTemplate,
			videoSrc: deferredPreviewVideoSrc,
			transcriptPages: deferredTokens,
			mediaMode: 'preview' as const,
		}),
		[deferredPreviewVideoSrc, deferredTemplate, deferredTokens]
	);
	const scrollAndSeekPreview = useCallback(
		(frame: number) => {
			const targetFrame = toPreviewFrame(frame);
			const seek = () => previewPlayerRef.current?.seekTo(targetFrame);

			setPreviewStartFrame(frame);
			previewSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
			requestAnimationFrame(seek);
			window.setTimeout(seek, 350);
		},
		[toPreviewFrame]
	);
	const applyTemplate = useCallback((next: InfographicTemplate, fallbackVideoSlug: string | null = null) => {
		setTitle(next.title);
		setHookText(next.hookText || '');
		setIntro(next.intro === true);
		setOutro(next.outro === true);
		setVideoBased(next.videoBased === true);
		setCaption(next.videoBased === true && next.caption === true);
		setVideoSlug(videoSlugFromFolder(next.videoFolder) ?? fallbackVideoSlug);
		setTheme({ ...defaultTheme, ...next.theme });
		setSegments(formSegments(next));
	}, []);
	useEffect(() => {
		void Promise.all([request<ProjectPayload>(`/api/projects/${slug}`), request<VideoSummary[]>('/api/videos')])
			.then(([project, list]) => {
				setName(project.name);
				setSlugDraft(project.slug);
				applyTemplate(project.template, project.videoSlug);
				setVideos(list);
				setLoaded(true);
			})
			.catch((e: Error) => setError(e.message));
	}, [slug, applyTemplate]);
	useEffect(() => {
		if (!loaded) return;
		setJsonDraft(JSON.stringify(template, null, 2));
		setJsonError(null);
	}, [template, loaded]);
	useEffect(() => {
		if (!videoSlug) {
			setTokens([]);
			setTokensLoaded(false);
			setTokensError('');
			return;
		}
		setTokensLoaded(false);
		setTokensError('');
		console.info('[tokens] loading transcript pages', { slug: videoSlug });
		void request<VideoDetail>(`/api/videos/${videoSlug}`)
			.then((video) => {
				const nextTokens = video.transcriptPages ?? [];
				console.info('[tokens] loaded transcript pages', {
					slug: videoSlug,
					pageCount: nextTokens.length,
				});
				setTokens(nextTokens);
				setTokensLoaded(true);
			})
			.catch((error) => {
				const message = error instanceof Error ? error.message : String(error);
				console.error('[tokens] failed to load transcript pages', { error, slug: videoSlug });
				setTokens([]);
				setTokensLoaded(true);
				setTokensError(message);
			});
	}, [videoSlug]);
	useEffect(() => {
		if (!renderJob) return;
		if (renderJob.status === 'failed') {
			const nextError = renderJob.error || renderJob.deliveryError || 'Render failed.';
			console.error('[render] job failed', renderJob);
			setRenderStatus('error');
			setRenderError(`${nextError} The page shouldn't reload.`);
			return;
		}
		if (renderJob.status === 'completed') {
			if (renderJob.error) {
				console.error('[render] job completed with errors', renderJob);
				setRenderStatus('error');
				setRenderError(`${renderJob.error} The page shouldn't reload.`);
			} else if (renderJob.deliveryError) {
				console.warn('[render] local render completed but delivery failed', renderJob);
				setDeliveryWarning(`Local MP4 completed, but Google delivery failed: ${renderJob.deliveryError}`);
			}
			return;
		}
		console.info('[render] polling job', { id: renderJob.id, status: renderJob.status, stage: renderJob.stage });
		const timer = setInterval(() => void request<RenderJob>(`/api/jobs/${renderJob.id}`).then(setRenderJob), 1000);
		return () => clearInterval(timer);
	}, [renderJob]);
	const captionsMissing = videoBased && caption && videoSlug && tokensLoaded && tokens.length === 0;
	const captionsLoadIssue =
		videoBased && caption && tokensError ? `Could not load captions for ${videoSlug}: ${tokensError}` : '';
	const cannotRender = (videoBased && !videoSlug) || Boolean(jsonError);
	const sourceVideoDisabled = !videoBased;
	const noticeMessage =
		error ||
		renderError ||
		deliveryWarning ||
		captionsLoadIssue ||
		(captionsMissing ? 'Captions are enabled, but this video has no tokens.json yet.' : message);
	const renderNotice =
		renderStatus === 'submitting' ? 'Render request sent. Waiting for the job to be created...' : null;
	useEffect(() => {
		const visibleMessages = [renderNotice, noticeMessage].filter(Boolean);

		if (!visibleMessages.length) {
			return;
		}

		console.info('[ui] visible message', {
			messages: visibleMessages,
			renderJob: renderJob
				? {
						deliveryStatus: renderJob.deliveryStatus ?? null,
						deliveryError: renderJob.deliveryError ?? null,
						error: renderJob.error ?? null,
						id: renderJob.id,
						stage: renderJob.stage,
						status: renderJob.status,
					}
				: null,
		});
	}, [noticeMessage, renderJob, renderNotice]);
	const save = async () => {
		const nextSlug = slugify(slugDraft);
		if (!nextSlug) throw new Error('Project slug is invalid.');
		const document: ProjectDocument = { schemaVersion: 1, name: name.trim(), videoSlug, template };
		await request(`/api/projects/${slug}`, jsonOptions('PUT', { slug: nextSlug, document }));
		setMessage('Saved to template.json.');
		if (nextSlug !== slug) navigate(`/projects/${nextSlug}`, { replace: true });
		return nextSlug;
	};
	const saveClick = async () => {
		try {
			setError('');
			await save();
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		}
	};
	const render = async () => {
		try {
			console.info('[render] button clicked', {
				email: notificationEmail.trim() || null,
				projectSlug: slug,
				sourceVideo: videoSlug,
			});
			setError('');
			setRenderError('');
			setDeliveryWarning('');
			setRenderStatus('submitting');
			const savedSlug = await save();
			const job = await request<RenderJob>(
				`/api/projects/${savedSlug}/render`,
				jsonOptions('POST', { email: notificationEmail.trim() || undefined })
			);
			console.info('[render] job queued', job);
			setRenderJob(job);
			setRenderStatus('idle');
			if (job.error) {
				console.error('[render] queue response included an error', job);
				setRenderStatus('error');
				setRenderError(`${job.error} The page shouldn't reload.`);
			}
		} catch (e) {
			const message = e instanceof Error ? e.message : String(e);
			console.error('[render] request failed', e);
			setRenderStatus('error');
			setRenderError(`${message} The page shouldn't reload.`);
		}
	};
	const updateSegment = (index: number, key: keyof FormSegment, value: FormSegment[keyof FormSegment]) =>
		setSegments((current) =>
			current.map((segment, i) => {
				if (i !== index) return segment;
				if (key === 'layout') {
					const layout = String(value) as LayoutKind;
					return { ...segment, layout, durationSeconds: String(LAYOUT_SPECS[layout].durationSeconds) };
				}
				return { ...segment, [key]: value };
			})
		);
	const move = (index: number, direction: -1 | 1) =>
		setSegments((current) => {
			const target = index + direction;
			if (target < 0 || target >= current.length) return current;
			const next = [...current];
			const [item] = next.splice(index, 1);
			next.splice(target, 0, item);
			return next;
		});
	const changeJson = (value: string) => {
		setJsonDraft(value);
		setCopied(false);
		try {
			const parsed = templateSchema.parse(JSON.parse(value)) as InfographicTemplate;
			applyTemplate(parsed);
			setJsonError(null);
		} catch (e) {
			setJsonError(e instanceof Error ? e.message : 'Invalid JSON');
		}
	};

	if (!loaded)
		return (
			<main className="mx-auto max-w-[1800px] px-5 py-6 sm:px-7">
				<p className={error ? errorNotice : 'text-indigo-100/70'}>{error || 'Loading project...'}</p>
			</main>
		);
	return (
		<main className="mx-auto max-w-[1800px] px-5 py-6 pb-20 sm:px-7">
			<div className="mb-4 grid items-end gap-2 md:grid-cols-2 xl:grid-cols-[minmax(220px,1.2fr)_minmax(190px,0.9fr)_minmax(240px,1.2fr)_minmax(120px,0.55fr)_minmax(145px,0.65fr)]">
				<label className={field}>
					<span className={fieldLabel}>Project name</span>
					<input className={input} value={name} onChange={(e) => setName(e.target.value)} />
				</label>
				<label className={field}>
					<span className={fieldLabel}>Project slug</span>
					<input className={input} value={slugDraft} onChange={(e) => setSlugDraft(e.target.value)} />
				</label>
				<label className={field}>
					<span className={fieldLabel}>Notification email</span>
					<input
						className={input}
						placeholder="Optional"
						value={notificationEmail}
						onChange={(e) => setNotificationEmail(e.target.value)}
					/>
				</label>
				<button className={`${secondaryButton} h-[50px]`} type="button" onClick={() => void saveClick()}>
					Save
				</button>
				<button
					className={`${button} h-[50px]`}
					disabled={cannotRender}
					type="button"
					onClick={(event) => {
						event.preventDefault();
						event.stopPropagation();
						void render();
					}}
				>
					{renderStatus === 'submitting' ? 'Rendering...' : 'Render MP4'}
				</button>
			</div>
			{renderNotice ? (
				<div className="mb-4 rounded-xl border border-cyan-200/55 bg-cyan-900/80 p-3 font-extrabold text-cyan-100">
					{renderNotice}
				</div>
			) : null}
			{noticeMessage && (
				<div className={error || renderError ? `${errorNotice} mb-4 mt-0` : `${notice} mb-4 mt-0 p-3`}>
					{noticeMessage}
				</div>
			)}
			{renderJob && (
				<div className="mb-4 grid items-center gap-2 rounded-xl bg-slate-950/80 p-3 md:grid-cols-[auto_minmax(180px,1fr)_auto_auto]">
					<strong>{renderJob.stage.replaceAll('-', ' ')}</strong>
					<progress className="w-full accent-indigo-500" max="1" value={renderJob.progress} />
					<span>{Math.round(renderJob.progress * 100)}%</span>
					{renderJob.deliveryStatus && (
						<em className="not-italic text-rose-300">Delivery: {renderJob.deliveryStatus}</em>
					)}
					{renderJob.recipientEmail && (
						<em className="not-italic text-rose-300 md:col-span-full">To: {renderJob.recipientEmail}</em>
					)}
					{renderJob.driveConfigured && renderJob.driveLink && (
						<a className="text-cyan-200" href={renderJob.driveLink}>
							Drive link
						</a>
					)}
					{renderJob.error && <em className="not-italic text-rose-300 md:col-span-full">{renderJob.error}</em>}
					{renderJob.deliveryError && (
						<em className="not-italic text-rose-300 md:col-span-full">{renderJob.deliveryError}</em>
					)}
					{renderJob.downloadUrl && (
						<a className="text-cyan-200" href={renderJob.downloadUrl}>
							Download MP4
						</a>
					)}
				</div>
			)}
			<div className="grid items-stretch gap-5 xl:grid-cols-[minmax(340px,0.95fr)_minmax(360px,1fr)_minmax(340px,0.9fr)]">
				<section className={`${panel} min-h-[720px] rounded-[20px] p-6`}>
					<div className="flex items-center justify-between">
						<div>
							<p className={eyebrow}>Template builder</p>
							<h1 className="my-1 text-3xl font-black text-white">{title}</h1>
						</div>
					</div>
					<div className="mt-4 grid gap-3">
						<label className={field}>
							<span className={fieldLabel}>Template title</span>
							<input className={input} value={title} onChange={(e) => setTitle(e.target.value)} />
						</label>
						<label className={field}>
							<span className={fieldLabel}>Source video</span>
							<select
								className={input}
								disabled={sourceVideoDisabled}
								value={videoSlug || ''}
								onChange={(e) => setVideoSlug(e.target.value || null)}
							>
								<option value="">No video</option>
								{videos.map((video) => (
									<option value={video.slug} key={video.slug}>
										{video.slug}
										{video.hasTokens ? ' (captioned)' : ''}
									</option>
								))}
							</select>
						</label>
						<label className={field}>
							<span className={fieldLabel}>Hook text</span>
							<input
								className={input}
								disabled={!intro}
								value={hookText}
								onChange={(e) => setHookText(e.target.value)}
							/>
						</label>
						<div className="flex flex-wrap gap-4 text-indigo-100">
							<label className="flex items-center gap-2">
								<input
									className="h-4 w-4"
									checked={intro}
									onChange={(e) => setIntro(e.target.checked)}
									type="checkbox"
								/>{' '}
								Intro
							</label>
							<label className="flex items-center gap-2">
								<input
									className="h-4 w-4"
									checked={outro}
									onChange={(e) => setOutro(e.target.checked)}
									type="checkbox"
								/>{' '}
								Outro
							</label>
							<label className="flex items-center gap-2">
								<input
									checked={videoBased}
									className="h-4 w-4"
									onChange={(e) => {
										setVideoBased(e.target.checked);
										if (!e.target.checked) setCaption(false);
									}}
									type="checkbox"
								/>
								Video-based
							</label>
							<label className="flex items-center gap-2">
								<input
									checked={caption}
									className="h-4 w-4"
									disabled={!videoBased}
									onChange={(e) => setCaption(e.target.checked)}
									type="checkbox"
								/>
								Captions
							</label>
						</div>
					</div>
					<section className="mt-6 border-t border-sky-200/15 pt-5">
						<div className="flex items-center justify-between">
							<h2 className="my-1 text-2xl font-black text-white">Theme</h2>
						</div>
						<ThemeEditor
							theme={theme}
							onChange={(key, value) => setTheme((current) => ({ ...current, [key]: value }))}
						/>
					</section>
				</section>
				<JsonPanel
					className="min-h-[720px]"
					copied={copied}
					json={jsonDraft}
					jsonError={jsonError}
					onJsonChange={changeJson}
					onCopy={() => {
						void navigator.clipboard.writeText(jsonDraft);
						setCopied(true);
					}}
				/>
				<aside className="grid">
					<section ref={previewSectionRef} className={`${panel} flex min-h-[720px] flex-col rounded-[20px] p-6`}>
						<div className="mb-4 grid gap-3">
							<div>
								<h2 className="m-0 text-2xl font-black text-white">Preview</h2>
							</div>
							<div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
								<select
									aria-label="Preview quality"
									className="h-10 min-w-[190px] rounded-lg border-0 bg-slate-800/90 px-3 text-sm font-extrabold text-white outline-none"
									onChange={(event) => setPreviewQuality(event.target.value as PreviewQuality)}
									value={previewQuality}
								>
									{Object.entries(previewQualityOptions).map(([value, option]) => (
										<option key={value} value={value}>
											{option.label} FPS
										</option>
									))}
								</select>
								<span className="flex h-10 items-center rounded-lg px-2 text-sm font-black text-indigo-100/75">
									{Math.round(durationInFrames / FPS)}s / {previewDurationInFrames}f
								</span>
							</div>
						</div>
						<div className="flex flex-1 items-start justify-center">
							<div className="flex w-full flex-col items-end">
								<div className="aspect-[1080/1920] w-full max-w-[380px] overflow-visible rounded-xl bg-black">
									<Player
										ref={previewPlayerRef}
										initialFrame={previewInitialFrame}
										key={`preview-${previewQuality}-${videoSlug ?? 'none'}-${previewInitialFrame}`}
										acknowledgeRemotionLicense
										audioLatencyHint="playback"
										bufferStateDelayInMilliseconds={180}
										component={InfographicVideo}
										inputProps={previewInputProps}
										durationInFrames={previewDurationInFrames}
										compositionWidth={VIDEO_WIDTH}
										compositionHeight={VIDEO_HEIGHT}
										fps={previewFps}
										controls
										alwaysShowControls
										numberOfSharedAudioTags={1}
										overflowVisible
										style={{ width: '100%', height: '100%' }}
									/>
								</div>
							</div>
						</div>
					</section>
				</aside>
			</div>

			<section className={`${panel} mt-6 rounded-[20px] p-6`}>
				<div className="flex items-center justify-between">
					<div>
						<p className={eyebrow}>Scenes</p>
						<h2 className="my-1 text-2xl font-black text-white">
							{segments.length} segment{segments.length === 1 ? '' : 's'}
						</h2>
					</div>
					<button className={secondaryButton} onClick={() => setSegments((current) => [...current, newSegment()])}>
						Add scene
					</button>
				</div>
				<div className="mt-4 grid gap-4">
					{segments.map((segment, index) => (
						<article className="grid gap-3" key={index}>
							<div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-sky-200/15 bg-slate-950/35 px-5 py-4">
								<strong className="text-xl text-white">Segment {index + 1}</strong>
								<div className="flex flex-wrap justify-end gap-2">
									<button
										className={secondaryButton}
										disabled={index === 0}
										onClick={() => move(index, -1)}
										type="button"
									>
										Up
									</button>
									<button
										className={secondaryButton}
										disabled={index === segments.length - 1}
										onClick={() => move(index, 1)}
										type="button"
									>
										Down
									</button>
									<button
										className={secondaryButton}
										onClick={() =>
											setSegments((current) => [
												...current.slice(0, index + 1),
												{ ...current[index] },
												...current.slice(index + 1),
											])
										}
										type="button"
									>
										Duplicate
									</button>
									<button
										className={secondaryButton}
										onClick={() =>
											setSegments((current) =>
												current.length > 1 ? current.filter((_, currentIndex) => currentIndex !== index) : current
											)
										}
										type="button"
									>
										Remove
									</button>
								</div>
							</div>
							<div
								className={
									segment.videoShown
										? 'grid gap-4'
										: 'grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(280px,390px)] xl:gap-0'
								}
							>
								<SegmentEditor
									index={index}
									segment={segment}
									theme={theme}
									videoBased={videoBased}
									onUpdate={updateSegment}
								/>
								{segment.videoShown ? null : (
									<div className="min-w-0">
										<LayoutPreview
											accent={segment.accent || theme.accent}
											endFrame={segmentRanges[index]?.endFrame ?? 0}
											onSeekToStart={() => scrollAndSeekPreview(segmentRanges[index]?.startFrame ?? 0)}
											segment={segment}
											startFrame={segmentRanges[index]?.startFrame ?? 0}
											theme={theme}
										/>
									</div>
								)}
							</div>
						</article>
					))}
				</div>
			</section>
		</main>
	);
};
