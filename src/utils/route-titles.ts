/**
 * Route titles
 */
export const getTitle = (route: string): string => {
  if (route.indexOf('/feed/top') > -1) {
    return 'Top';
  } else if (route.indexOf('/subs') > -1) {
    return 'Subscriptions';
  } else if (route.indexOf('/settings') > -1) {
    return 'Settings';
  } else if (route.indexOf('/recents') > -1) {
    return 'Recents';
  } else {
    return 'Podcst';
  }
};
