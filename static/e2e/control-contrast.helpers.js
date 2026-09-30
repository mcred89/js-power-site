const { expect } = require('./fixtures');

// Read the rendered colors, including transparent controls over themed ancestors.
// This intentionally checks browser output rather than mirroring CSS token names.
const renderedAppearance = elements => {
  const parse = color => {
    const channels = color.match(/[\d.]+/g).map(Number);
    return [...channels.slice(0, 3), channels.length === 4 ? channels[3] : 1];
  };
  const over = (foreground, background) => {
    const alpha = foreground[3] + background[3] * (1 - foreground[3]);
    return [...foreground.slice(0, 3).map((channel, index) => (
      channel * foreground[3] + background[index] * background[3] * (1 - foreground[3])
    ) / (alpha || 1)), alpha];
  };
  const luminance = color => color.slice(0, 3).map(channel => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  }).reduce((total, value, index) => total + value * [0.2126, 0.7152, 0.0722][index], 0);
  const appearance = element => {
    const style = getComputedStyle(element);
    let background = [0, 0, 0, 0];
    let ancestor = element;
    while (ancestor && background[3] < 1) {
      background = over(background, parse(getComputedStyle(ancestor).backgroundColor));
      ancestor = ancestor.parentElement;
    }
    background = over(background, [255, 255, 255, 1]);
    const foreground = over(parse(style.color), background);
    const light = Math.max(luminance(foreground), luminance(background));
    const dark = Math.min(luminance(foreground), luminance(background));
    return {
      color: style.color,
      background: style.backgroundColor,
      contrast: (light + 0.05) / (dark + 0.05),
      opacity: style.opacity,
      fontWeight: Number(style.fontWeight),
      outlineStyle: style.outlineStyle,
      outlineWidth: Number.parseFloat(style.outlineWidth),
      label: element.getAttribute('aria-label') || element.textContent.trim().replace(/\s+/g, ' ').slice(0, 100),
    };
  };

  if (!Array.isArray(elements)) return appearance(elements);
  return elements.filter(element => {
    const rect = element.getBoundingClientRect();
    const visibility = getComputedStyle(element).visibility;
    return rect.width > 0 && rect.height > 0 && visibility === 'visible'
      && !element.matches(':disabled, [aria-disabled="true"]');
  }).map(appearance);
};

const readAppearance = locator => locator.evaluate(renderedAppearance);

const assertContrast = appearance => {
  expect(appearance.contrast, `${appearance.label}: ${appearance.color} on ${appearance.background}`).toBeGreaterThanOrEqual(4.5);
};

const assertReadable = async locator => {
  const appearance = await readAppearance(locator);
  assertContrast(appearance);
  return appearance;
};

const assertReadableControls = async scope => {
  // Take one browser snapshot so a toast expiring cannot shift indexes between
  // the visibility check and the color measurement of neighboring controls.
  const appearances = await scope.locator('button, summary, [role="status"], [role="alert"]')
    .evaluateAll(renderedAppearance);
  appearances.forEach(assertContrast);
};

module.exports = { assertReadable, assertReadableControls, readAppearance };
