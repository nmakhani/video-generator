import { AbsoluteFill, Audio, OffthreadVideo, Sequence, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import {
	OUTRO_DURATION_SECONDS,
	INTRO_HOOK_DURATION_SECONDS,
	getSegmentDurationInFrames,
	isVideoShownSegment,
	type InfographicSegment,
} from '../layoutCatalog';
import { BRAND_FONTS, DEFAULT_VIDEO_FONT, videoFontStyle } from '../brand';
import { FontGate } from './FontGate';
import { CaptionsOverlay } from './CaptionsOverlay';
import { IntroHookOverlay } from './IntroHookOverlay';
import { SegmentScene } from './SegmentScene';
import { SceneHeader } from './scene/SceneHeader';
import type { InfographicVideoProps } from './types';

type SegmentRange = {
	durationInFrames: number;
	from: number;
	segment: InfographicSegment;
};

type VideoOnlySceneProps = {
	mediaMode: 'preview' | 'render';
	muted?: boolean;
	startFrom: number;
	videoSrc: string;
};

const videoFillStyle = {
	height: '100%',
	objectFit: 'cover' as const,
	width: '100%',
};

const getSegmentKey = (segment: InfographicSegment, index: number): string =>
	isVideoShownSegment(segment) ? `video-${index}` : `${segment.layout}-${index}`;

const getSegmentRanges = (segments: InfographicSegment[], fps: number): SegmentRange[] => {
	let cursor = 0;

	return segments.map((segment) => {
		const durationInFrames = getSegmentDurationInFrames(segment, fps);
		const range = {
			durationInFrames,
			from: cursor,
			segment,
		};

		cursor += durationInFrames;

		return range;
	});
};

const isVideoVisibleAtFrame = (ranges: SegmentRange[], frame: number): boolean =>
	ranges.some(
		({ durationInFrames, from, segment }) =>
			isVideoShownSegment(segment) && frame >= from && frame < from + durationInFrames
	);

const SyncedVideo = ({ muted = false, startFrom, videoSrc }: VideoOnlySceneProps) => (
	<OffthreadVideo muted={muted} src={videoSrc} startFrom={startFrom} style={videoFillStyle} />
);

const VideoOnlyScene = ({ mediaMode, muted, startFrom, videoSrc }: VideoOnlySceneProps) => (
	<AbsoluteFill style={{ background: '#000000' }}>
		<SyncedVideo mediaMode={mediaMode} muted={muted} startFrom={startFrom} videoSrc={videoSrc} />
	</AbsoluteFill>
);

const getOutroDurationInFrames = (fps: number): number => Math.round(OUTRO_DURATION_SECONDS * fps);

export const InfographicVideo = ({
	mediaMode = 'render',
	transcriptPages = [],
	template,
	videoSrc,
}: InfographicVideoProps) => {
	const frame = useCurrentFrame();
	const { fps } = useVideoConfig();
	const isPreview = mediaMode === 'preview';
	const fontFamily = template.fontFamily ?? DEFAULT_VIDEO_FONT;
	const segmentRanges = getSegmentRanges(template.segments, fps);
	const segmentEndFrame = segmentRanges.reduce(
		(endFrame, range) => Math.max(endFrame, range.from + range.durationInFrames),
		0
	);
	const outroDurationInFrames = template.outro === true ? getOutroDurationInFrames(fps) : 0;
	const isVideoBased = template.videoBased === true;
	const introDurationInFrames = template.intro === true ? Math.round(INTRO_HOOK_DURATION_SECONDS * fps) : 0;
	const showCaptions =
		isVideoBased && template.caption === true && transcriptPages.length > 0 && frame >= introDurationInFrames;
	const showVideoLayer = Boolean(videoSrc) && isVideoBased && isVideoVisibleAtFrame(segmentRanges, frame);
	const sourceVideoOpacity = isPreview ? 1 : showVideoLayer ? 1 : 0;

	return (
		<AbsoluteFill
			style={{
				...videoFontStyle(fontFamily),
				background: template.theme.background,
				color: template.theme.text,
				fontFamily: BRAND_FONTS.subheading,
			}}
		>
			{!isPreview ? <FontGate fontFamily={fontFamily} /> : null}

			{videoSrc && isVideoBased ? (
				<>
					<AbsoluteFill
						style={{
							background: '#000000',
							opacity: sourceVideoOpacity,
						}}
					>
						<SyncedVideo mediaMode={mediaMode} startFrom={0} videoSrc={videoSrc} />
					</AbsoluteFill>
					{!isPreview ? <Audio src={videoSrc} /> : null}
				</>
			) : null}

			{segmentRanges.map(({ durationInFrames, from, segment }, index) => {
				if (isVideoShownSegment(segment)) {
					if (!videoSrc || isVideoBased) {
						return null;
					}

					return (
						<Sequence durationInFrames={durationInFrames} from={from} key={getSegmentKey(segment, index)}>
							<VideoOnlyScene mediaMode={mediaMode} startFrom={from} videoSrc={videoSrc} />
						</Sequence>
					);
				}

				return (
					<Sequence durationInFrames={durationInFrames} from={from} key={getSegmentKey(segment, index)}>
						<SegmentScene
							durationInFrames={durationInFrames}
							index={index}
							segment={segment}
							template={template}
							total={template.segments.length}
						/>
					</Sequence>
				);
			})}

			{template.outro === true ? (
				<Sequence durationInFrames={outroDurationInFrames} from={segmentEndFrame}>
					<VideoOnlyScene mediaMode={mediaMode} startFrom={0} videoSrc={staticFile('outro.mp4')} />
				</Sequence>
			) : null}

			{showCaptions ? <CaptionsOverlay transcriptPages={transcriptPages} /> : null}

			{template.intro === true ? <IntroHookOverlay template={template} /> : null}

			<SceneHeader theme={{ ...template.theme }} />
		</AbsoluteFill>
	);
};
