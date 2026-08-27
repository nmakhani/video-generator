import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { createTikTokStyleCaptions } from '@remotion/captions';
import {
	downloadWhisperModel,
	installWhisperCpp,
	toCaptions,
	transcribe,
	type WhisperModel,
} from '@remotion/install-whisper-cpp';
import type { JobManifest } from '../src/shared/schemas';
import type { TranscriptPage } from '../src/video/types';
import { atomicWriteJson, exists, videoPaths } from './fs-store';

const WHISPER_CPP_VERSION = '1.5.5';
const model = (process.env.WHISPER_MODEL || 'medium.en') as WhisperModel;
const cacheRoot = process.env.LOCALAPPDATA || resolve(homedir(), '.cache', 'remotion-whisper');
const whisperPath = resolve(cacheRoot, 'remotion-whisper', 'whisper.cpp');
const TRANSCRIPTION_PROGRESS_START = 0.55;
const TRANSCRIPTION_PROGRESS_END = 0.9;

export const mapTranscriptionProgress = (progress: number): number => {
	const normalized = Number.isFinite(progress) ? Math.min(1, Math.max(0, progress)) : 0;
	return TRANSCRIPTION_PROGRESS_START + normalized * (TRANSCRIPTION_PROGRESS_END - TRANSCRIPTION_PROGRESS_START);
};

const createTranscriptionProgressReporter = (update: (patch: Partial<JobManifest>) => Promise<void>) => {
	let latestProgress = 0;
	let pendingWrite = Promise.resolve();

	return {
		report(progress: number) {
			const normalized = Number.isFinite(progress) ? Math.min(1, Math.max(0, progress)) : 0;
			if (normalized <= latestProgress) return;
			latestProgress = normalized;
			pendingWrite = pendingWrite.then(() =>
				update({ stage: 'transcribing', progress: mapTranscriptionProgress(normalized) })
			);
		},
		flush: () => pendingWrite,
	};
};

const run = (command: string, args: string[]) =>
	new Promise<void>((done, reject) => {
		const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], shell: false });
		let stderr = '';
		child.stderr.on('data', (chunk) => {
			stderr += String(chunk).slice(-8000);
		});
		child.once('error', reject);
		child.once('close', (code) =>
			code === 0 ? done() : reject(new Error(`${command} failed (${code}). ${stderr.trim()}`))
		);
	});

export const verifyVideo = async (path: string) =>
	run('ffprobe', [
		'-v',
		'error',
		'-select_streams',
		'v:0',
		'-show_entries',
		'stream=codec_name',
		'-of',
		'default=nw=1',
		path,
	]);

const executableCandidates = [
	'main.exe',
	'main',
	join('build', 'bin', 'main.exe'),
	join('build', 'bin', 'main'),
	join('build', 'bin', 'whisper-cli.exe'),
	join('build', 'bin', 'whisper-cli'),
];
const hasWhisper = () => executableCandidates.some((candidate) => existsSync(resolve(whisperPath, candidate)));
const modelCandidates = () => [
	resolve(whisperPath, 'models', `ggml-${model}.bin`),
	resolve(whisperPath, `ggml-${model}.bin`),
];

const ensureWhisper = async (update: (patch: Partial<JobManifest>) => Promise<void>) => {
	await mkdir(cacheRoot, { recursive: true });
	if (!hasWhisper()) {
		await update({ stage: 'installing-whisper', progress: 0.35 });
		await rm(whisperPath, { recursive: true, force: true });
		await installWhisperCpp({ to: whisperPath, version: WHISPER_CPP_VERSION, printOutput: true });
	}
	if (!modelCandidates().some(existsSync)) {
		await update({ stage: 'downloading-model', progress: 0.45 });
		await downloadWhisperModel({ model, folder: whisperPath, printOutput: true });
	}
};

export const buildTokens = (captions: Parameters<typeof createTikTokStyleCaptions>[0]['captions']) =>
	createTikTokStyleCaptions({ captions, combineTokensWithinMilliseconds: 2000 }).pages.map((page) => ({
		startMs: page.startMs,
		durationMs: page.durationMs,
		endMs: Math.round(page.startMs + page.durationMs),
		text: page.text,
		tokens: page.tokens.map((token) => ({ text: token.text, fromMs: token.fromMs, toMs: token.toMs })),
	}));

type TimedCaption = Parameters<typeof buildTokens>[0][number];

const captionWords = (text: string) => text.trim().split(/\s+/).filter(Boolean);

const normalizedWord = (word: string) => {
	const normalized = word
		.normalize('NFKC')
		.toLocaleLowerCase()
		.replace(/[^\p{L}\p{N}]+/gu, '');
	return normalized || word.toLocaleLowerCase();
};

type WordAnchor = { captionIndex: number; wordIndex: number };

const findWordAnchors = (captions: TimedCaption[], words: string[]): WordAnchor[] => {
	const originalWords = captions.map((caption) => normalizedWord(caption.text.trim()));
	const editedWords = words.map(normalizedWord);
	const width = editedWords.length + 1;
	const cellCount = (originalWords.length + 1) * width;

	// Very long transcripts use one proportional segment to keep memory bounded.
	if (cellCount > 5_000_000) return [];

	const lengths = new Uint32Array(cellCount);
	for (let captionIndex = originalWords.length - 1; captionIndex >= 0; captionIndex -= 1) {
		for (let wordIndex = editedWords.length - 1; wordIndex >= 0; wordIndex -= 1) {
			const cell = captionIndex * width + wordIndex;
			lengths[cell] =
				originalWords[captionIndex] === editedWords[wordIndex]
					? lengths[(captionIndex + 1) * width + wordIndex + 1] + 1
					: Math.max(lengths[(captionIndex + 1) * width + wordIndex], lengths[cell + 1]);
		}
	}

	const anchors: WordAnchor[] = [];
	let captionIndex = 0;
	let wordIndex = 0;
	while (captionIndex < originalWords.length && wordIndex < editedWords.length) {
		if (originalWords[captionIndex] === editedWords[wordIndex]) {
			anchors.push({ captionIndex, wordIndex });
			captionIndex += 1;
			wordIndex += 1;
		} else if (lengths[(captionIndex + 1) * width + wordIndex] >= lengths[captionIndex * width + wordIndex + 1]) {
			captionIndex += 1;
		} else {
			wordIndex += 1;
		}
	}

	return anchors;
};

const removeInsertionOnlyAnchors = (anchors: WordAnchor[], captionCount: number, wordCount: number): WordAnchor[] => {
	const stable = [...anchors];
	let changed = true;
	while (changed) {
		changed = false;
		let previousCaptionIndex = -1;
		let previousWordIndex = -1;
		for (let index = 0; index <= stable.length; index += 1) {
			const next = stable[index] ?? { captionIndex: captionCount, wordIndex: wordCount };
			const hasNoSourceTime = next.captionIndex === previousCaptionIndex + 1;
			const hasInsertedWords = next.wordIndex > previousWordIndex + 1;
			if (hasNoSourceTime && hasInsertedWords && captionCount > 0) {
				const anchorToRemove = index < stable.length ? index : index - 1;
				if (anchorToRemove >= 0) {
					stable.splice(anchorToRemove, 1);
					changed = true;
					break;
				}
			}
			previousCaptionIndex = next.captionIndex;
			previousWordIndex = next.wordIndex;
		}
	}
	return stable;
};

const retimeWords = (captions: TimedCaption[], words: string[], wordOffset: number): TimedCaption[] => {
	if (!words.length || !captions.length) return [];
	const startMs = captions[0].startMs;
	const endMs = captions[captions.length - 1].endMs;
	const durationMs = Math.max(0, endMs - startMs);
	const weights = words.map((word) => Math.max(1, normalizedWord(word).length));
	const totalWeight = weights.reduce((total, weight) => total + weight, 0);
	let elapsedWeight = 0;

	return words.map((word, index) => {
		const wordStartMs = Math.round(startMs + durationMs * (elapsedWeight / totalWeight));
		elapsedWeight += weights[index];
		const wordEndMs = Math.round(startMs + durationMs * (elapsedWeight / totalWeight));
		const sourceIndex = Math.min(captions.length - 1, Math.floor((index / words.length) * captions.length));
		return {
			...captions[sourceIndex],
			text: `${wordOffset + index === 0 ? '' : ' '}${word}`,
			startMs: wordStartMs,
			endMs: wordEndMs,
			timestampMs: Math.round((wordStartMs + wordEndMs) / 2),
		};
	});
};

export const captionTextFromItems = (captions: TimedCaption[]) =>
	captions
		.map((caption) => caption.text)
		.join('')
		.trim();

export const replaceCaptionText = (captions: TimedCaption[], text: string): TimedCaption[] => {
	const words = captionWords(text);
	const anchors = removeInsertionOnlyAnchors(findWordAnchors(captions, words), captions.length, words.length);
	const result: TimedCaption[] = [];
	let previousCaptionIndex = -1;
	let previousWordIndex = -1;

	for (let anchorIndex = 0; anchorIndex <= anchors.length; anchorIndex += 1) {
		const anchor = anchors[anchorIndex] ?? { captionIndex: captions.length, wordIndex: words.length };
		const changedCaptions = captions.slice(previousCaptionIndex + 1, anchor.captionIndex);
		const changedWords = words.slice(previousWordIndex + 1, anchor.wordIndex);
		result.push(...retimeWords(changedCaptions, changedWords, previousWordIndex + 1));

		if (anchorIndex < anchors.length) {
			const caption = captions[anchor.captionIndex];
			result.push({
				...caption,
				text: `${anchor.wordIndex === 0 ? '' : ' '}${words[anchor.wordIndex]}`,
			});
		}
		previousCaptionIndex = anchor.captionIndex;
		previousWordIndex = anchor.wordIndex;
	}

	return result;
};

const readCaptions = async (slug: string): Promise<TimedCaption[]> => {
	const path = videoPaths(slug).captions;
	if (!(await exists(path)))
		throw Object.assign(new Error('Generate captions before editing them.'), {
			code: 'CAPTIONS_NOT_FOUND',
			status: 404,
		});
	const raw = JSON.parse(await readFile(path, 'utf8'));
	const captions = Array.isArray(raw) ? raw : raw.captions;
	if (!Array.isArray(captions) || captions.some((caption) => typeof caption?.text !== 'string'))
		throw Object.assign(new Error('captions.json is invalid.'), { code: 'INVALID_CAPTIONS', status: 500 });
	return captions as TimedCaption[];
};

export const getCaptionText = async (slug: string) => captionTextFromItems(await readCaptions(slug));

export const updateCaptionText = async (
	slug: string,
	text: string
): Promise<{ captionText: string; transcriptPages: TranscriptPage[] }> => {
	const paths = videoPaths(slug);
	const captions = replaceCaptionText(await readCaptions(slug), text);
	const transcriptPages = buildTokens(captions) as TranscriptPage[];
	await atomicWriteJson(paths.captions, captions);
	await atomicWriteJson(paths.tokens, transcriptPages);
	return { captionText: captionTextFromItems(captions), transcriptPages };
};

export const runCaptionPipeline = async (job: JobManifest, update: (patch: Partial<JobManifest>) => Promise<void>) => {
	if (!job.videoSlug || !job.action) throw new Error('Caption job is missing its video or action.');
	const paths = videoPaths(job.videoSlug);
	const force = job.force === true;
	if (!existsSync(paths.video)) throw new Error('Source video.mp4 is missing.');

	const wantsAudio = job.action === 'audio' || job.action === 'full';
	const wantsCaptions = job.action === 'captions' || job.action === 'full';
	const wantsTokens = job.action === 'tokens' || job.action === 'full';
	const wantsPreview = job.action === 'preview' || job.action === 'full';
	const cleanup = [];
	if (force && wantsPreview) cleanup.push(rm(paths.preview, { force: true }));
	if (force && wantsAudio)
		cleanup.push(
			rm(paths.audio, { force: true }),
			rm(paths.captions, { force: true }),
			rm(paths.tokens, { force: true })
		);
	else if (force && wantsCaptions) cleanup.push(rm(paths.captions, { force: true }), rm(paths.tokens, { force: true }));
	else if (force && wantsTokens) cleanup.push(rm(paths.tokens, { force: true }));
	await Promise.all(cleanup);

	if (wantsPreview && !existsSync(paths.preview)) {
		await update({ stage: 'building-preview', progress: 0.05 });
		await run('ffmpeg', [
			'-y',
			'-i',
			paths.video,
			'-map',
			'0:v:0',
			'-map',
			'0:a:0?',
			'-vf',
			'scale=540:-2',
			'-c:v',
			'libx264',
			'-preset',
			'veryfast',
			'-crf',
			'28',
			'-pix_fmt',
			'yuv420p',
			'-c:a',
			'aac',
			'-b:a',
			'96k',
			'-ac',
			'2',
			'-movflags',
			'+faststart',
			paths.preview,
		]);
		await update({ stage: 'preview-ready', progress: 0.2 });
	}

	if (wantsAudio && !existsSync(paths.audio)) {
		await update({ stage: 'extracting-audio', progress: 0.1 });
		await run('ffmpeg', [
			'-y',
			'-i',
			paths.video,
			'-vn',
			'-ac',
			'1',
			'-ar',
			'16000',
			'-sample_fmt',
			's16',
			paths.audio,
		]);
	}
	if (wantsCaptions && !existsSync(paths.captions)) {
		if (!existsSync(paths.audio))
			throw new Error('audio.wav is required. Generate audio first or run the full pipeline.');
		await ensureWhisper(update);
		await update({ stage: 'transcribing', progress: TRANSCRIPTION_PROGRESS_START });
		const transcriptionProgress = createTranscriptionProgressReporter(update);
		const output = await transcribe({
			inputPath: paths.audio,
			whisperPath,
			whisperCppVersion: WHISPER_CPP_VERSION,
			model,
			tokenLevelTimestamps: true,
			splitOnWord: true,
			printOutput: true,
			onProgress: transcriptionProgress.report,
		});
		await transcriptionProgress.flush();
		await update({ stage: 'saving-captions', progress: 0.92 });
		const { captions } = toCaptions({ whisperCppOutput: output });
		if (!captions.length) throw new Error('Transcription completed without captions.');
		await atomicWriteJson(paths.captions, captions);
	}
	if (wantsTokens && !existsSync(paths.tokens)) {
		if (!existsSync(paths.captions))
			throw new Error('captions.json is required. Generate captions first or run the full pipeline.');
		await update({ stage: 'building-tokens', progress: 0.96 });
		const raw = JSON.parse(await readFile(paths.captions, 'utf8'));
		const captions = Array.isArray(raw) ? raw : raw.captions;
		if (!Array.isArray(captions)) throw new Error('captions.json is invalid.');
		await atomicWriteJson(paths.tokens, buildTokens(captions));
	}
};
