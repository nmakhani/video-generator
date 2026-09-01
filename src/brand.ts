import type { CSSProperties } from 'react';

export const BRAND_COLORS = {
	primary: '#606bfa',
	secondary: '#a0a6fc',
	dark: '#131532',
	surface: '#1b1e46',
	text: '#f7f8ff',
	highlight: '#af74ff',
	muted: '#c9cdfd',
} as const;

export const VIDEO_FONT_IDS = ['gued', 'arial', 'georgia', 'trebuchet', 'courier'] as const;

export type VideoFontFamily = (typeof VIDEO_FONT_IDS)[number];

export const DEFAULT_VIDEO_FONT: VideoFontFamily = 'gued';

export const VIDEO_FONT_OPTIONS: ReadonlyArray<{
	cssFamily: string;
	label: string;
	value: VideoFontFamily;
}> = [
	{
		value: 'gued',
		label: 'Gued',
		cssFamily: '"Gued", "Arial Black", Arial, sans-serif',
	},
	{
		value: 'arial',
		label: 'Arial',
		cssFamily: 'Arial, Helvetica, sans-serif',
	},
	{
		value: 'georgia',
		label: 'Georgia',
		cssFamily: 'Georgia, "Times New Roman", serif',
	},
	{
		value: 'trebuchet',
		label: 'Trebuchet MS',
		cssFamily: '"Trebuchet MS", Arial, sans-serif',
	},
	{
		value: 'courier',
		label: 'Courier New',
		cssFamily: '"Courier New", Courier, monospace',
	},
];

export const getVideoFontFamily = (font: VideoFontFamily = DEFAULT_VIDEO_FONT): string =>
	VIDEO_FONT_OPTIONS.find((option) => option.value === font)?.cssFamily ?? VIDEO_FONT_OPTIONS[0].cssFamily;

export const videoFontStyle = (font: VideoFontFamily = DEFAULT_VIDEO_FONT) =>
	({ '--video-font-family': getVideoFontFamily(font) }) as CSSProperties;

const VIDEO_FONT_CSS_VALUE = `var(--video-font-family, ${VIDEO_FONT_OPTIONS[0].cssFamily})`;

export const BRAND_FONTS = {
	heading: VIDEO_FONT_CSS_VALUE,
	subheading: VIDEO_FONT_CSS_VALUE,
} as const;
