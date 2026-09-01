import { cancelRender, continueRender, delayRender } from 'remotion';
import { useEffect, useRef } from 'react';
import type { VideoFontFamily } from '../brand';

const loadCustomFonts = async (fontFamily: VideoFontFamily) => {
	if (typeof document === 'undefined' || !document.fonts) return;

	if (fontFamily === 'gued') {
		await Promise.all([
			document.fonts.load('400 1em "Gued"'),
			document.fonts.load('700 1em "Gued"'),
			document.fonts.load('950 1em "Gued"'),
			document.fonts.ready,
		]);

		if (!document.fonts.check('400 1em "Gued"') || !document.fonts.check('950 1em "Gued"')) {
			throw new Error('Gued could not be loaded. The render was stopped to prevent a fallback font.');
		}
	}
};

export const FontGate = ({ fontFamily }: { fontFamily: VideoFontFamily }) => {
	const handleRef = useRef<number | null>(null);

	if (handleRef.current === null) {
		handleRef.current = delayRender('Loading custom fonts');
	}

	useEffect(() => {
		const handle = handleRef.current;
		if (handle === null) return;

		loadCustomFonts(fontFamily)
			.then(() => {
				continueRender(handle);
			})
			.catch((error) => {
				cancelRender(error instanceof Error ? error : new Error(String(error)));
			});
	}, [fontFamily]);

	return null;
};
