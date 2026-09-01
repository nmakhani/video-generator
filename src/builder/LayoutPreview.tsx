import { Thumbnail } from '@remotion/player';
import { useMemo } from 'react';
import {
	FPS,
	LAYOUT_SPECS,
	VIDEO_HEIGHT,
	VIDEO_WIDTH,
	getSegmentDurationInFrames,
	type AnimationSegment,
	type InfographicTemplate,
	type Theme,
} from '../layoutCatalog';
import { SegmentScene } from '../video/SegmentScene';
import type { SegmentSceneProps } from '../video/types';
import type { FormSegment } from './types';
import type { VideoFontFamily } from '../brand';

type LayoutPreviewProps = {
	accent: string;
	endFrame: number;
	fontFamily: VideoFontFamily;
	onSeekToStart: () => void;
	startFrame: number;
	segment: FormSegment;
	theme: Theme;
};

const parseItems = (value: string): string[] =>
	value
		.split(/\r?\n/)
		.map((item) => item.trim())
		.filter(Boolean);

const parseValues = (value: string): number[] =>
	value
		.split(',')
		.map((item) => Number(item.trim()))
		.filter((item) => Number.isFinite(item));

const toPreviewSegment = (segment: FormSegment, accent: string): AnimationSegment => {
	const items = parseItems(segment.itemsText);
	const values = parseValues(segment.valuesText);

	return {
		videoShown: false,
		layout: segment.layout,
		title: segment.title.trim() || LAYOUT_SPECS[segment.layout].label,
		durationSeconds: LAYOUT_SPECS[segment.layout].durationSeconds,
		...(segment.subtitle.trim() ? { subtitle: segment.subtitle.trim() } : {}),
		...(segment.metric.trim() ? { metric: segment.metric.trim() } : {}),
		...(accent.trim() ? { accent: accent.trim() } : {}),
		...(items.length > 0 ? { items } : {}),
		...(values.length > 0 ? { values } : {}),
	};
};

const formatSeconds = (frame: number): string => {
	const seconds = frame / FPS;
	const rounded = Math.round(seconds * 10) / 10;

	return `${Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1)}s`;
};

export const LayoutPreview = ({
	accent,
	endFrame,
	fontFamily,
	onSeekToStart,
	startFrame,
	segment,
	theme,
}: LayoutPreviewProps) => {
	const previewSegment = useMemo(() => toPreviewSegment(segment, accent), [accent, segment]);
	const durationInFrames = getSegmentDurationInFrames(previewSegment, FPS);
	const frameToDisplay = Math.max(0, Math.min(durationInFrames - 24, Math.round(durationInFrames * 0.75)));
	const template = useMemo<InfographicTemplate>(
		() => ({
			title: 'Layout preview',
			fontFamily,
			intro: false,
			outro: false,
			videoBased: false,
			caption: false,
			theme,
			segments: [previewSegment],
		}),
		[fontFamily, previewSegment, theme]
	);
	const inputProps = useMemo<SegmentSceneProps>(
		() => ({
			durationInFrames,
			index: 0,
			segment: previewSegment,
			template,
			total: 1,
		}),
		[durationInFrames, previewSegment, template]
	);

	return (
		<div className="flex h-full w-full flex-col">
			<div className="ml-auto flex w-full max-w-[380px] flex-col items-end">
				<div className="aspect-[9/16] w-full overflow-hidden rounded-xl border-[2px] border-white/25 bg-black shadow-lg shadow-black/30">
					<Thumbnail
						component={SegmentScene}
						compositionHeight={VIDEO_HEIGHT}
						compositionWidth={VIDEO_WIDTH}
						durationInFrames={durationInFrames}
						fps={FPS}
						frameToDisplay={frameToDisplay}
						inputProps={inputProps}
						noSuspense
						style={{ height: '100%', width: '100%' }}
					/>
				</div>
				<button
					className="mt-2 grid w-full gap-1 rounded-2xl border border-cyan-200/20 bg-gradient-to-br from-slate-950 via-slate-950 to-slate-900/90 px-4 py-3 text-left shadow-[0_14px_42px_rgba(0,0,0,0.3),inset_0_1px_0_rgba(255,255,255,0.08)] transition hover:-translate-y-px hover:border-cyan-200/35 hover:from-slate-900 hover:to-slate-800/95"
					onClick={onSeekToStart}
					type="button"
				>
					<div className="flex items-center justify-between gap-3">
						<span className="text-[10px] font-black uppercase tracking-[0.18em] text-indigo-100/55">
							Video position
						</span>
						<span className="rounded-full border border-cyan-200/15 bg-cyan-400/10 px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.14em] text-cyan-100">
							Click to jump
						</span>
					</div>
					<div className="grid gap-2">
						<div className="flex items-baseline justify-between gap-3">
							<span className="text-[11px] font-bold text-indigo-100/60">Starts</span>
							<span className="text-sm font-black leading-tight text-white">{formatSeconds(startFrame)}</span>
						</div>
						<div className="flex items-baseline justify-between gap-3">
							<span className="text-[11px] font-bold text-indigo-100/60">Ends</span>
							<span className="text-sm font-black leading-tight text-white">{formatSeconds(endFrame)}</span>
						</div>
					</div>
				</button>
			</div>
		</div>
	);
};
