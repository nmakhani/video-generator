import { describe, expect, it } from 'vitest';
import { buildTokens, captionTextFromItems, replaceCaptionText } from '../server/pipeline';

const captions = [
	{ text: 'Hello', startMs: 10, endMs: 1000, timestampMs: 500, confidence: 0.9 },
	{ text: ' afan', startMs: 1000, endMs: 1800, timestampMs: 1400, confidence: 0.5 },
	{ text: ' here', startMs: 1800, endMs: 2300, timestampMs: 2000, confidence: 0.8 },
];

describe('caption text editing', () => {
	it('presents timed caption items as editable transcript text', () => {
		expect(captionTextFromItems(captions)).toBe('Hello afan here');
	});

	it('replaces words without changing timing or metadata', () => {
		const updated = replaceCaptionText(captions, 'Hello Affan here');

		expect(updated[1]).toEqual({ ...captions[1], text: ' Affan' });
		expect(captionTextFromItems(updated)).toBe('Hello Affan here');
	});

	it('merges words and spans their combined timing', () => {
		const source = [
			{ ...captions[0], text: 'SPC' },
			{ ...captions[1], text: ' Tech' },
			{ ...captions[2], text: ' works' },
		];
		const updated = replaceCaptionText(source, 'SPCTech works');

		expect(updated).toHaveLength(2);
		expect(updated[0]).toMatchObject({ text: 'SPCTech', startMs: 10, endMs: 1800 });
		expect(updated[1]).toMatchObject({ text: ' works', startMs: 1800, endMs: 2300 });
		expect(
			buildTokens(updated)
				.flatMap((page) => page.tokens)
				.map((token) => token.text)
				.join('')
				.trim()
		).toBe('SPCTech works');
	});

	it('splits a word and distributes its original timing', () => {
		const source = [
			{ ...captions[0], text: 'SPCTech', startMs: 10, endMs: 1810 },
			{ ...captions[2], text: ' works', startMs: 1810, endMs: 2300 },
		];
		const updated = replaceCaptionText(source, 'SPC Tech works');

		expect(updated).toHaveLength(3);
		expect(updated[0]).toMatchObject({ text: 'SPC', startMs: 10, endMs: 781 });
		expect(updated[1]).toMatchObject({ text: ' Tech', startMs: 781, endMs: 1810 });
		expect(updated[2]).toMatchObject({ text: ' works', startMs: 1810, endMs: 2300 });
	});

	it('supports inserted words while keeping timestamps monotonic', () => {
		const updated = replaceCaptionText(captions, 'Hello brave new here');

		expect(captionTextFromItems(updated)).toBe('Hello brave new here');
		expect(updated).toHaveLength(4);
		expect(updated.every((caption, index) => index === 0 || caption.startMs >= updated[index - 1].endMs)).toBe(true);
	});

	it('removes words without changing the remaining word timing', () => {
		const updated = replaceCaptionText(captions, 'Hello here');

		expect(updated).toHaveLength(2);
		expect(updated[0]).toMatchObject({ text: 'Hello', startMs: 10, endMs: 1000 });
		expect(updated[1]).toMatchObject({ text: ' here', startMs: 1800, endMs: 2300 });
	});
});
