export const NAVIGATION_EVENT = 'mcilroy:before-navigation';

// Editors register only while open, keeping the navigation shell independent
// of the lazy form code.
export const confirmNavigation = (history = false) => window.dispatchEvent(new CustomEvent(NAVIGATION_EVENT, { cancelable: true, detail: history }));
