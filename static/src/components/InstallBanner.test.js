import { installInstructions } from './InstallBanner';

describe('installation guidance', () => {
  it.each([
    ['Firefox/143.0 Android', 0, 'Firefox menu'],
    ['Firefox/143.0 Windows NT 10.0', 0, 'web apps button'],
    ['Firefox/143.0 Linux', 0, 'does not offer app installation'],
    ['Firefox/143.0 Macintosh', 0, 'does not offer app installation'],
    ['iPhone FxiOS/143.0', 0, 'Safari'],
    ['Macintosh Safari/605.1.15', 5, 'Add to Home Screen'],
    ['Chrome/143.0 Edg/143.0', 0, 'In Edge, check Apps'],
    ['Chrome/143.0', 0, 'Chrome or Brave'],
  ])('explains the available route for %s', (userAgent, touchPoints, expected) => {
    expect(installInstructions(userAgent, touchPoints)).toContain(expected);
  });
});
