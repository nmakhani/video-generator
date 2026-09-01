import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { DEFAULT_VIDEO_FONT, videoFontStyle } from '../brand';
import { ANIMATION_SAFE_ZONE_BOTTOM_PX, defaultTheme } from '../layoutCatalog';
import { SceneBackdrop } from './scene/SceneBackdrop';
import { renderLayout } from './layouts/renderLayout';
import type { SegmentSceneProps } from './types';
import { enterStyle, headingTextStyle, reveal, scaleFrameCount, subheadingTextStyle } from './utils';

export const SegmentScene = ({ durationInFrames, index, segment, template }: SegmentSceneProps) => {
	const frame = useCurrentFrame();
	const { fps } = useVideoConfig();
	const theme = { ...defaultTheme, ...template.theme };
	const accent = segment.accent ?? theme.accent;
	const intro = spring({
		fps,
		frame,
		config: {
			damping: 18,
			mass: 0.8,
			stiffness: 90,
		},
	});
	const outro = interpolate(frame, [durationInFrames - scaleFrameCount(18, fps), durationInFrames - 1], [1, 0], {
		extrapolateLeft: 'clamp',
		extrapolateRight: 'clamp',
	});

	return (
		<AbsoluteFill
			style={{
				...videoFontStyle(template.fontFamily ?? DEFAULT_VIDEO_FONT),
				background: theme.background,
				color: theme.text,
				opacity: outro,
				overflow: 'hidden',
				padding: '82px 74px 70px',
			}}
		>
			<SceneBackdrop accent={accent} frame={frame} progress={intro} theme={theme} />
			<section
				style={{
					marginTop: 66,
					position: 'relative',
					zIndex: 2,
					...enterStyle(reveal(frame, fps), 18),
				}}
			>
				<h1
					style={{
						...headingTextStyle,
						fontSize: 78,
						fontWeight: 950,
						lineHeight: 0.95,
						margin: 0,
						maxWidth: 920,
					}}
				>
					{segment.title}
				</h1>
				{segment.subtitle ? (
					<p
						style={{
							...subheadingTextStyle,
							color: theme.muted,
							fontSize: 31,
							lineHeight: 1.28,
							margin: '26px 0 0',
							maxWidth: 850,
						}}
					>
						{segment.subtitle}
					</p>
				) : null}
			</section>

			<main
				style={{
					alignItems: 'center',
					display: 'flex',
					flex: 1,
					maxHeight: `calc(100% - ${ANIMATION_SAFE_ZONE_BOTTOM_PX}px)`,
					justifyContent: 'center',
					marginTop: 34,
					minHeight: 0,
					paddingBottom: ANIMATION_SAFE_ZONE_BOTTOM_PX,
					position: 'relative',
					zIndex: 2,
				}}
			>
				{renderLayout({
					accent,
					durationInFrames,
					frame,
					index,
					progress: intro,
					segment,
					theme,
				})}
			</main>
		</AbsoluteFill>
	);
};
