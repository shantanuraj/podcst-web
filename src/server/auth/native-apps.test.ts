import { describe, expect, it } from 'bun:test';
import {
  acceptedOrigins,
  androidOrigin,
  appleAppSiteAssociation,
  assetLinks,
} from './native-apps';

const release =
  '87:BF:91:7A:3C:54:A3:EA:FE:4F:58:D4:CD:30:44:61:61:C8:1E:18:4A:05:AB:3E:A1:15:7C:B7:85:50:46:5F';
const releaseOrigin =
  'android:apk-key-hash:h7-RejxUo-r-T1jUzTBEYWHIHhhKBas-oRV8t4VQRl8';

describe('native app identity', () => {
  it('derives the Android origin as the unpadded base64url certificate digest', () => {
    expect(androidOrigin(release)).toBe(releaseOrigin);
  });

  it('accepts the web, Apple and every Android origin together', () => {
    expect(
      acceptedOrigins('podcst.app', 'https://www.podcst.app').sort(),
    ).toEqual(
      ['https://www.podcst.app', 'https://podcst.app', releaseOrigin].sort(),
    );
  });

  it('accepts the plain localhost origin for local development', () => {
    expect(acceptedOrigins('localhost', 'http://localhost:3000')).toContain(
      'http://localhost',
    );
  });

  it('grants Android sign-in credentials and app links to the release certificate', () => {
    expect(assetLinks).toEqual([
      {
        relation: [
          'delegate_permission/common.get_login_creds',
          'delegate_permission/common.handle_all_urls',
        ],
        target: {
          namespace: 'android_app',
          package_name: 'app.podcst.android',
          sha256_cert_fingerprints: [release],
        },
      },
    ]);
  });

  it('keeps the iOS web credentials association', () => {
    expect(appleAppSiteAssociation).toEqual({
      webcredentials: { apps: ['DBD4H768ZS.app.podcst.ios'] },
    });
  });
});
