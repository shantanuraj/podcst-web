'use client';

import { useCallback, useEffect, useState } from 'react';
import styles from './LanguagePicker.module.css';

const LANGUAGE_COOKIE = 'NEXT_UI_LANG';

type Language = 'en' | 'nl' | 'fr' | 'sv' | 'ko' | 'es';

const languages: { code: Language; name: string; native: string }[] = [
  { code: 'en', name: 'English', native: 'English' },
  { code: 'nl', name: 'Dutch', native: 'Nederlands' },
  { code: 'fr', name: 'French', native: 'Français' },
  { code: 'sv', name: 'Swedish', native: 'Svenska' },
  { code: 'ko', name: 'Korean', native: '한국어' },
  { code: 'es', name: 'Spanish', native: 'Español' },
];

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
        const isSelected = lang.code === currentLanguage;
        return (
          <label
            key={lang.code}
            className={styles.option}
            data-selected={isSelected}
          >
            <input
              type="radio"
              name="language"
              value={lang.code}
              checked={isSelected}
              onChange={handleChange}
              className="sr-only"
            />
            <span className={styles.native}>{lang.native}</span>
            <span className={styles.name}>{lang.name}</span>
          </label>
        );
      })}
    </div>
  );
}

