export const OPEN_SEARCH = 'search:open';

export const openSearch = () => {
  window.dispatchEvent(new Event(OPEN_SEARCH));
};
