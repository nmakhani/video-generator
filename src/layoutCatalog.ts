import { BRAND_COLORS, type VideoFontFamily } from './brand';

export const FPS = 30;
export const VIDEO_WIDTH = 1080;
export const VIDEO_HEIGHT = 1920;
export const OUTRO_DURATION_SECONDS = 8;
export const TEXT_BOTTOM_OFFSET_PX = 264;
export const INTRO_HOOK_DURATION_SECONDS = 4;
export const ANIMATION_SAFE_ZONE_BOTTOM_PX = 300;

export type LayoutKind =
	| 'flowchart'
	| 'barGraph'
	| 'timeline'
	| 'comparison'
	| 'radial'
	| 'matrix'
	| 'stats'
	| 'process'
	| 'pyramid'
	| 'roadmap'
	| 'hierarchy'
	| 'quadrant';

export type Theme = {
	background: string;
	surface: string;
	primary: string;
	secondary: string;
	dark: string;
	accent: string;
	text: string;
	muted: string;
};

export const DEFAULT_VIDEO_SCENE_DURATION_SECONDS = 5;
export const MIN_VIDEO_SCENE_DURATION_SECONDS = 0.25;
export const MAX_VIDEO_SCENE_DURATION_SECONDS = 600;

export type AnimationSegment = {
	videoShown?: false;
	layout: LayoutKind;
	title: string;
	durationSeconds?: number;
	subtitle?: string;
	metric?: string;
	accent?: string;
	items?: string[];
	values?: number[];
};

export type VideoShownSegment = {
	videoShown: true;
	durationSeconds: number;
};

export type InfographicSegment = AnimationSegment | VideoShownSegment;

export type InfographicTemplate = {
	title: string;
	fontFamily?: VideoFontFamily;
	caption?: boolean;
	hookText?: string;
	intro?: boolean;
	outro?: boolean;
	videoBased?: boolean;
	videoFolder?: string;
	theme: Theme;
	segments: InfographicSegment[];
};

export type LayoutSpec = {
	label: string;
	durationSeconds: number;
	minDurationSeconds: number;
	maxDurationSeconds: number;
	minItems: number;
	maxItems: number;
	recommendedItems: number;
};

export const defaultTheme: Theme = {
	background: BRAND_COLORS.dark,
	surface: BRAND_COLORS.surface,
	primary: BRAND_COLORS.primary,
	secondary: BRAND_COLORS.secondary,
	dark: BRAND_COLORS.dark,
	accent: BRAND_COLORS.primary,
	text: BRAND_COLORS.text,
	muted: BRAND_COLORS.muted,
};

export const LAYOUT_SPECS: Record<LayoutKind, LayoutSpec> = {
	flowchart: {
		label: 'Flowchart',
		durationSeconds: 5,
		minDurationSeconds: 3,
		maxDurationSeconds: 12,
		minItems: 3,
		maxItems: 6,
		recommendedItems: 5,
	},
	barGraph: {
		label: 'Bar graph',
		durationSeconds: 6,
		minDurationSeconds: 3,
		maxDurationSeconds: 12,
		minItems: 3,
		maxItems: 7,
		recommendedItems: 5,
	},
	timeline: {
		label: 'Timeline',
		durationSeconds: 6,
		minDurationSeconds: 3,
		maxDurationSeconds: 12,
		minItems: 3,
		maxItems: 6,
		recommendedItems: 5,
	},
	comparison: {
		label: 'Comparison',
		durationSeconds: 5,
		minDurationSeconds: 3,
		maxDurationSeconds: 12,
		minItems: 4,
		maxItems: 8,
		recommendedItems: 6,
	},
	radial: {
		label: 'Radial map',
		durationSeconds: 6,
		minDurationSeconds: 3,
		maxDurationSeconds: 14,
		minItems: 4,
		maxItems: 8,
		recommendedItems: 6,
	},
	matrix: {
		label: 'Matrix',
		durationSeconds: 5,
		minDurationSeconds: 3,
		maxDurationSeconds: 10,
		minItems: 4,
		maxItems: 4,
		recommendedItems: 4,
	},
	stats: {
		label: 'Stats stack',
		durationSeconds: 5,
		minDurationSeconds: 3,
		maxDurationSeconds: 12,
		minItems: 2,
		maxItems: 6,
		recommendedItems: 4,
	},
	process: {
		label: 'Process',
		durationSeconds: 6,
		minDurationSeconds: 3,
		maxDurationSeconds: 14,
		minItems: 3,
		maxItems: 7,
		recommendedItems: 5,
	},
	pyramid: {
		label: 'Pyramid',
		durationSeconds: 5,
		minDurationSeconds: 3,
		maxDurationSeconds: 12,
		minItems: 3,
		maxItems: 6,
		recommendedItems: 5,
	},
	roadmap: {
		label: 'Roadmap',
		durationSeconds: 6,
		minDurationSeconds: 3,
		maxDurationSeconds: 14,
		minItems: 3,
		maxItems: 6,
		recommendedItems: 5,
	},
	hierarchy: {
		label: 'Hierarchy',
		durationSeconds: 6,
		minDurationSeconds: 3,
		maxDurationSeconds: 14,
		minItems: 4,
		maxItems: 10,
		recommendedItems: 7,
	},
	quadrant: {
		label: 'Quadrant',
		durationSeconds: 5,
		minDurationSeconds: 3,
		maxDurationSeconds: 10,
		minItems: 4,
		maxItems: 4,
		recommendedItems: 4,
	},
};

export const layoutKinds = Object.keys(LAYOUT_SPECS) as LayoutKind[];

const clampNumber = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

export const isVideoShownSegment = (segment: InfographicSegment): segment is VideoShownSegment =>
	segment.videoShown === true;

export const getLayoutItemCount = (segment: AnimationSegment): number => {
	const spec = LAYOUT_SPECS[segment.layout];
	const providedItems = segment.items?.filter(Boolean).length ?? 0;
	const requestedItems = providedItems > 0 ? providedItems : spec.recommendedItems;

	return Math.round(clampNumber(requestedItems, spec.minItems, spec.maxItems));
};

export const getSegmentDurationSeconds = (segment: InfographicSegment): number => {
	if (isVideoShownSegment(segment)) {
		const requestedDuration = Number(segment.durationSeconds);
		const duration = Number.isFinite(requestedDuration) ? requestedDuration : DEFAULT_VIDEO_SCENE_DURATION_SECONDS;

		return clampNumber(duration, MIN_VIDEO_SCENE_DURATION_SECONDS, MAX_VIDEO_SCENE_DURATION_SECONDS);
	}

	const spec = LAYOUT_SPECS[segment.layout];
	const requestedDuration = Number(segment.durationSeconds);
	const duration = Number.isFinite(requestedDuration) ? requestedDuration : spec.durationSeconds;

	return clampNumber(duration, spec.minDurationSeconds, spec.maxDurationSeconds);
};

export const getSegmentDurationInFrames = (segment: InfographicSegment, fps = FPS): number =>
	Math.round(getSegmentDurationSeconds(segment) * fps);

export const getTemplateDurationInFrames = (template: InfographicTemplate, fps = FPS): number => {
	const segmentFrames = template.segments.reduce((sum, segment) => sum + getSegmentDurationInFrames(segment, fps), 0);
	const outroFrames = template.outro === true ? OUTRO_DURATION_SECONDS * fps : 0;
	const frames = segmentFrames + outroFrames;

	return Math.max(frames, fps * 5);
};
