import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { jsonOptions, request, type VideoDetail } from '../api';
import type { JobManifest, PipelineRequest } from '../shared/schemas';
import { button, errorNotice, eyebrow, input, mutedText, pageShell, panel, secondaryButton } from '../ui';

const stageDetails: Record<string, { label: string; description: string }> = {
	queued: { label: 'Queued', description: 'Waiting for the current task to begin.' },
	starting: { label: 'Starting', description: 'Preparing the caption pipeline.' },
	'building-preview': { label: 'Building preview', description: 'Creating a smaller browser-friendly preview MP4.' },
	'preview-ready': { label: 'Preview ready', description: 'The lightweight editor preview has been created.' },
	'extracting-audio': { label: 'Extracting audio', description: 'Creating a clean 16 kHz audio track.' },
	'installing-whisper': { label: 'Installing Whisper', description: 'Preparing the transcription engine.' },
	'downloading-model': { label: 'Downloading model', description: 'Downloading the selected Whisper model.' },
	transcribing: { label: 'Transcribing', description: 'Whisper is converting speech into timed text.' },
	'saving-captions': { label: 'Saving captions', description: 'Writing the timestamped caption file.' },
	'building-tokens': { label: 'Building tokens', description: 'Formatting captions for the video overlay.' },
	completed: { label: 'Completed', description: 'The video and caption files are ready.' },
	failed: { label: 'Pipeline failed', description: 'The pipeline could not finish.' },
	interrupted: { label: 'Pipeline interrupted', description: 'The application stopped during processing.' },
};

export const VideoDetailPage = () => {
	const { slug = '' } = useParams();
	const [video, setVideo] = useState<VideoDetail | null>(null);
	const [job, setJob] = useState<JobManifest | null>(null);
	const [force, setForce] = useState(false);
	const [error, setError] = useState('');
	const [captionText, setCaptionText] = useState('');
	const [savedCaptionText, setSavedCaptionText] = useState('');
	const [captionSaveStatus, setCaptionSaveStatus] = useState<'idle' | 'saving'>('idle');
	const [captionMessage, setCaptionMessage] = useState('');
	const jobRunning = Boolean(job && !['completed', 'failed'].includes(job.status));
	const progressPercent = job ? Math.round(Math.min(1, Math.max(0, job.progress)) * 100) : 0;
	const stage = job ? (stageDetails[job.stage] ?? { label: job.stage.replaceAll('-', ' '), description: '' }) : null;
	const load = useCallback(
		() =>
			request<VideoDetail>(`/api/videos/${slug}`).then((value) => {
				setVideo(value);
				setCaptionText(value.captionText || '');
				setSavedCaptionText(value.captionText || '');
				if (value.activeJob) setJob(value.activeJob);
			}),
		[slug]
	);
	useEffect(() => {
		void load().catch((e: Error) => setError(e.message));
	}, [load]);
	useEffect(() => {
		if (!job || ['completed', 'failed'].includes(job.status)) return;
		const timer = setInterval(
			() =>
				void request<JobManifest>(`/api/jobs/${job.id}`).then((next) => {
					setJob(next);
					if (['completed', 'failed'].includes(next.status)) void load();
				}),
			300
		);
		return () => clearInterval(timer);
	}, [job, load]);
	const run = async (action: PipelineRequest['action']) => {
		try {
			setError('');
			setCaptionMessage('');
			setJob(await request(`/api/videos/${slug}/pipeline`, jsonOptions('POST', { action, force })));
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		}
	};
	const saveCaptions = async () => {
		try {
			setError('');
			setCaptionMessage('');
			setCaptionSaveStatus('saving');
			const result = await request<Pick<VideoDetail, 'captionText' | 'transcriptPages'>>(
				`/api/videos/${slug}/captions`,
				jsonOptions('PUT', { text: captionText })
			);
			setCaptionText(result.captionText);
			setSavedCaptionText(result.captionText);
			setVideo((current) =>
				current
					? { ...current, captionText: result.captionText, hasTokens: true, transcriptPages: result.transcriptPages }
					: current
			);
			setCaptionMessage('Caption corrections saved and render tokens rebuilt.');
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		} finally {
			setCaptionSaveStatus('idle');
		}
	};

	if (!video)
		return (
			<main className={pageShell}>
				<p className={error ? errorNotice : mutedText}>{error || 'Loading video...'}</p>
			</main>
		);

	return (
		<main className={pageShell}>
			<Link
				className="inline-flex rounded-full border border-transparent px-3.5 py-2 text-indigo-100 no-underline"
				to="/videos"
			>
				Back to video library
			</Link>
			<section className="mt-5 grid gap-7 lg:grid-cols-[minmax(300px,0.8fr)_minmax(420px,1.2fr)]">
				<div className={`${panel} rounded-3xl p-6`}>
					<video className="max-h-[70vh] w-full rounded-2xl bg-black" controls src={video.previewUrl} />
					<h1 className="mt-5 text-3xl font-black text-white">{slug}</h1>
				</div>
				<section className={`${panel} rounded-3xl p-6`}>
					<p className={eyebrow}>Caption pipeline</p>
					<h2 className="mt-2 text-2xl font-black text-white">Generate each artifact in order.</h2>
					<div className="my-6 grid gap-2.5">
						{[
							{
								done: video.hasPreview,
								label: '1. preview.mp4',
								action: 'preview' as const,
								disabled: false,
								buttonText: 'Generate preview',
							},
							{
								done: video.hasAudio,
								label: '2. audio.wav',
								action: 'audio' as const,
								disabled: false,
								buttonText: 'Generate audio',
							},
							{
								done: video.hasCaptions,
								label: '3. captions.json',
								action: 'captions' as const,
								disabled: !video.hasAudio,
								buttonText: 'Generate captions',
							},
							{
								done: video.hasTokens,
								label: '4. tokens.json',
								action: 'tokens' as const,
								disabled: !video.hasCaptions,
								buttonText: 'Build tokens',
							},
						].map((step) => (
							<div
								className={`flex items-center justify-between gap-3 rounded-xl border bg-slate-950/70 p-3 ${
									step.done ? 'border-emerald-300/45' : 'border-sky-200/15'
								}`}
								key={step.label}
							>
								<strong>{step.label}</strong>
								<button
									className={secondaryButton}
									disabled={step.disabled || Boolean(job && !['completed', 'failed'].includes(job.status))}
									onClick={() => void run(step.action)}
								>
									{step.buttonText}
								</button>
							</div>
						))}
					</div>
					{video.hasCaptions && (
						<div className="my-6 grid gap-3 rounded-2xl border border-sky-200/15 bg-slate-950/55 p-4">
							<div>
								<p className={eyebrow}>Editable transcript</p>
								<p className="mt-2 text-sm text-indigo-100/70">
									Correct spelling or merge and split words here. Saving realigns changed words and rebuilds the render
									tokens.
								</p>
							</div>
							<textarea
								aria-label="Caption transcript"
								className={`${input} min-h-52 resize-y leading-7`}
								disabled={jobRunning || captionSaveStatus === 'saving'}
								onChange={(event) => {
									setCaptionText(event.target.value);
									setCaptionMessage('');
								}}
								spellCheck
								value={captionText}
							/>
							<div className="flex flex-wrap items-center justify-between gap-3">
								<span className="text-sm text-indigo-100/65">
									{captionText.trim() ? captionText.trim().split(/\s+/).length : 0} timed words
								</span>
								<button
									className={secondaryButton}
									disabled={
										jobRunning ||
										captionSaveStatus === 'saving' ||
										captionText === savedCaptionText ||
										!captionText.trim()
									}
									onClick={() => void saveCaptions()}
									type="button"
								>
									{captionSaveStatus === 'saving' ? 'Saving...' : 'Save caption corrections'}
								</button>
							</div>
							{captionMessage && <p className="m-0 text-sm text-emerald-300">{captionMessage}</p>}
						</div>
					)}
					<label className="my-4 block text-indigo-100/75">
						<input checked={force} className="mr-2" onChange={(e) => setForce(e.target.checked)} type="checkbox" />
						Regenerate and invalidate downstream files
					</label>
					<button className={`${button} w-full`} disabled={jobRunning} onClick={() => void run('full')}>
						{jobRunning ? 'Pipeline running...' : 'Run full pipeline'}
					</button>
					{job && stage && (
						<div className={`${panel} mt-5 rounded-2xl p-5`} aria-live="polite">
							<div className="flex items-center justify-between gap-5">
								<div className="grid gap-1">
									<span className={eyebrow}>Caption pipeline</span>
									<strong className="text-lg text-white">{stage.label}</strong>
								</div>
								<span className="text-2xl font-black tabular-nums text-white">{progressPercent}%</span>
							</div>
							<div
								aria-label={`${stage.label}: ${progressPercent}%`}
								aria-valuemax={100}
								aria-valuemin={0}
								aria-valuenow={progressPercent}
								className="mt-4 h-3 overflow-hidden rounded-full border border-slate-400/10 bg-slate-400/15"
								role="progressbar"
							>
								<span
									className={`block h-full rounded-full ${
										job.status === 'failed'
											? 'bg-gradient-to-r from-rose-600 to-rose-400'
											: job.status === 'completed'
												? 'bg-gradient-to-r from-emerald-500 to-emerald-300'
												: 'bg-gradient-to-r from-indigo-500 via-indigo-400 to-cyan-300'
									}`}
									style={{ width: `${progressPercent}%` }}
								/>
							</div>
							{stage.description && <p className="mt-3 text-sm text-slate-300">{stage.description}</p>}
							{job.error && <p className="mt-3 rounded-xl bg-rose-500/10 p-3 text-sm text-rose-200">{job.error}</p>}
						</div>
					)}
					{error && <p className={errorNotice}>{error}</p>}
				</section>
			</section>
		</main>
	);
};
