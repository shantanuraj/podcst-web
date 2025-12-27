'use client';

import { useCallback, useEffect, useState } from 'react';
import { type Language, languageNames } from '@/messages';
import styles from './LanguagePicker.module.css';

const LANGUAGE_COOKIE = 'NEXT_UI_LANG';

const languages: Language[] = ['en', 'nl', 'fr', 'sv', 'ko', 'es'];

function getStoredLanguage(): Language {
  if (typeof document === 'undefined') return 'en';
  const match = document.cookie.match(new RegExp(`${LANGUAGE_COOKIE}=([^;]+)`));
  return (match?.[1] as Language) || 'en';
}

export function LanguagePicker() {
  const [currentLanguage, setCurrentLanguage] = useState<Language>('en');

  useEffect(() => {
    setCurrentLanguage(getStoredLanguage());
  }, []);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const newLang = e.target.value as Language;
    document.cookie = `${LANGUAGE_COOKIE}=${newLang};path=/;max-age=31536000`;
    setCurrentLanguage(newLang);
  }, []);

  return (
    <div className={styles.grid}>
      {languages.map((lang) => {
        const isSelected = lang === currentLanguage;
        const names = languageNames[lang];
        return (
          <label
            key={lang}
            className={styles.option}
            data-selected={isSelected}
          >
            <input
              type="radio"
              name="language"
              value={lang}
              checked={isSelected}
              onChange={handleChange}
              className="sr-only"
            />
            <span className={styles.native}>{names.native}</span>
            <span className={styles.name}>{names.english}</span>
          </label>
        );
      })}
    </div>
  );
}
