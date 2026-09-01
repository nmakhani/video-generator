import { z } from 'zod';
import { VIDEO_FONT_IDS } from '../brand';

export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const slugSchema = z.string().regex(SLUG_PATTERN, 'Use lowercase letters, numbers, and single hyphens.');

const VIDEO_FOLDER_PREFIX = '../../videos/';

export const videoFolderForSlug = (slug: string): string => slugSchema.parse(slug);

export const videoSlugFromFolder = (folder: string | undefined): string | null => {
	if (!folder) return null;
	if (slugSchema.safeParse(folder).success) return folder;
	if (!folder.startsWith(VIDEO_FOLDER_PREFIX)) return null;
	const parsed = slugSchema.safeParse(folder.slice(VIDEO_FOLDER_PREFIX.length));
	return parsed.success ? parsed.data : null;
};

export const videoFolderSchema = z
	.string()
	.refine((folder) => videoSlugFromFolder(folder) !== null, 'Use a video slug like my-video.');

export const themeSchema = z.object({
	background: z.string(),
	surface: z.string(),
	primary: z.string(),
	secondary: z.string(),
	dark: z.string(),
	accent: z.string(),
	text: z.string(),
	muted: z.string(),
});

const videoSegmentSchema = z.object({
	videoShown: z.literal(true),
	durationSeconds: z.number().positive(),
});

const animatedSegmentSchema = z.object({
	videoShown: z.literal(false).optional(),
	layout: z.enum([
		'flowchart',
		'barGraph',
		'timeline',
		'comparison',
		'radial',
		'matrix',
		'stats',
		'process',
		'pyramid',
		'roadmap',
		'hierarchy',
		'quadrant',
	]),
	title: z.string().min(1),
	durationSeconds: z.number().positive().optional(),
	subtitle: z.string().optional(),
	metric: z.string().optional(),
	accent: z.string().optional(),
	items: z.array(z.string()).optional(),
	values: z.array(z.number()).optional(),
});

export const templateSchema = z.object({
	title: z.string().min(1),
	fontFamily: z.enum(VIDEO_FONT_IDS).optional(),
	caption: z.boolean().optional(),
	hookText: z.string().optional(),
	intro: z.boolean().optional(),
	outro: z.boolean().optional(),
	videoBased: z.boolean().optional(),
	videoFolder: videoFolderSchema.optional(),
	theme: themeSchema,
	segments: z.array(z.union([videoSegmentSchema, animatedSegmentSchema])).min(1),
});

export const projectDocumentSchema = z.object({
	schemaVersion: z.literal(1),
	name: z.string().trim().min(1).max(120),
	videoSlug: slugSchema.nullable(),
	template: templateSchema,
});

export const pipelineRequestSchema = z.object({
	action: z.enum(['preview', 'audio', 'captions', 'tokens', 'full']),
	force: z.boolean().default(false),
});

export const captionEditRequestSchema = z.object({
	text: z.string().trim().min(1, 'Caption text cannot be empty.').max(200_000, 'Caption text is too long.'),
});

export const renderRequestSchema = z.object({
	email: z.string().trim().email('Enter a valid notification email.').optional().or(z.literal('')),
});

export type ProjectDocument = z.infer<typeof projectDocumentSchema>;
export type CaptionEditRequest = z.infer<typeof captionEditRequestSchema>;
export type PipelineRequest = z.infer<typeof pipelineRequestSchema>;
export type RenderRequest = z.infer<typeof renderRequestSchema>;

export type JobManifest = {
	id: string;
	kind: 'caption-pipeline' | 'render';
	status: 'queued' | 'running' | 'completed' | 'failed';
	stage: string;
	progress: number;
	videoSlug?: string;
	projectSlug?: string;
	action?: PipelineRequest['action'];
	force?: boolean;
	recipientEmail?: string;
	driveConfigured?: boolean;
	driveLink?: string;
	driveName?: string;
	fileId?: string | null;
	emailConfigured?: boolean;
	emailSent?: boolean;
	deliveryStatus?: 'local' | 'uploaded' | 'emailed' | 'partial' | 'failed';
	deliveryError?: string;
	emailError?: string;
	createdAt: string;
	updatedAt: string;
	outputPath?: string;
	error?: string;
};
