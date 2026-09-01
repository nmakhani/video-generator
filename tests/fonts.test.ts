import { describe, expect, it } from 'vitest';
import { DEFAULT_VIDEO_FONT, getVideoFontFamily } from '../src/brand';
import { createDefaultTemplate } from '../src/shared/defaults';
import { templateSchema } from '../src/shared/schemas';

describe('video font selection', () => {
	it('uses Gued for new and legacy templates', () => {
		expect(createDefaultTemplate().fontFamily).toBe(DEFAULT_VIDEO_FONT);
		expect(getVideoFontFamily()).toContain('Gued');

		const legacyTemplate = createDefaultTemplate();
		delete legacyTemplate.fontFamily;

		expect(templateSchema.parse(legacyTemplate).fontFamily).toBeUndefined();
	});

	it('persists supported selections and rejects unknown fonts', () => {
		const template = createDefaultTemplate();
		expect(templateSchema.parse({ ...template, fontFamily: 'georgia' }).fontFamily).toBe('georgia');
		expect(templateSchema.safeParse({ ...template, fontFamily: 'missing-font' }).success).toBe(false);
	});
});
