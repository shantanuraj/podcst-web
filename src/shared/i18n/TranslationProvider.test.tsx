import { expect, test } from 'bun:test';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import { PathParamsContext } from 'next/dist/shared/lib/hooks-client-context.shared-runtime';
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { TranslationProvider, useTranslation } from './TranslationProvider';

function Consumer() {
  const { language, t } = useTranslation();
  return <span lang={language}>{t('discover.chart')}</span>;
}

function render(
  language?: string,
  children: ReactNode = <Consumer />,
  refresh = () => {},
) {
  return renderToStaticMarkup(
    <AppRouterContext.Provider
      value={{
        bfcacheId: 'fixture',
        back() {},
        forward() {},
        refresh,
        push() {},
        replace() {},
        prefetch() {},
      }}
    >
      <PathParamsContext.Provider
        value={language ? { language, locale: 'ca' } : {}}
      >
        <TranslationProvider>{children}</TranslationProvider>
      </PathParamsContext.Provider>
    </AppRouterContext.Provider>,
  );
}

test('cached Discover client components render in the explicit route language', () => {
  expect(render('fr')).toBe('<span lang="fr">Le classement</span>');
  expect(render('nl')).toBe('<span lang="nl">De hitlijst</span>');
});

test('selecting a language persists it before refreshing cached server content', () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: { cookie: 'NEXT_UI_LANG=en' },
  });
  let chooseLanguage: ReturnType<typeof useTranslation>['setLanguage'] =
    () => {};
  let cookieOnRefresh: string | undefined;
  function Capture() {
    chooseLanguage = useTranslation().setLanguage;
    return null;
  }
  try {
    render('en', <Capture />, () => {
      cookieOnRefresh = document.cookie;
    });
    chooseLanguage('fr');
    expect(cookieOnRefresh).toBe(
      'NEXT_UI_LANG=fr;path=/;max-age=31536000;samesite=lax',
    );
  } finally {
    if (previous) Object.defineProperty(globalThis, 'document', previous);
    else Reflect.deleteProperty(globalThis, 'document');
  }
});

test('initial rendering ignores browser cookies so hydration matches shared HTML', () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: { cookie: 'NEXT_UI_LANG=nl' },
  });
  try {
    expect(render('fr')).toBe('<span lang="fr">Le classement</span>');
    expect(render()).toBe('<span lang="en">The chart</span>');
  } finally {
    if (previous) Object.defineProperty(globalThis, 'document', previous);
    else Reflect.deleteProperty(globalThis, 'document');
  }
});

test.each([
  'unknown',
  'constructor',
])('invalid route language %s uses English', (language) => {
  expect(render(language)).toBe('<span lang="en">The chart</span>');
});
