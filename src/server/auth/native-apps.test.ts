import { describe, expect, it } from 'bun:test';
import {
  acceptedOrigins,
  androidOrigin,
  appleAppSiteAssociation,
  assetLinks,
} from './native-apps';

const certificates = [
  {
    fingerprint:
      '87:BF:91:7A:3C:54:A3:EA:FE:4F:58:D4:CD:30:44:61:61:C8:1E:18:4A:05:AB:3E:A1:15:7C:B7:85:50:46:5F',
    origin: 'android:apk-key-hash:h7-RejxUo-r-T1jUzTBEYWHIHhhKBas-oRV8t4VQRl8',
  },
  {
    fingerprint:
      'EB:09:43:81:1D:7D:86:E2:A2:FE:20:36:49:20:B1:E0:48:80:48:7E:7A:D0:26:F5:43:5B:6C:2A:27:41:98:D8',
    origin: 'android:apk-key-hash:6wlDgR19huKi_iA2SSCx4EiASH560Cb1Q1tsKidBmNg',
  },
  {
    fingerprint:
      'B5:24:60:6D:3E:F7:3C:F3:59:0D:DC:84:74:38:B6:2F:F7:57:4C:4C:BD:99:5A:40:02:A8:04:95:67:F2:A4:00',
    origin: 'android:apk-key-hash:tSRgbT73PPNZDdyEdDi2L_dXTEy9mVpAAqgElWfypAA',
  },
  {
    fingerprint:
      'C9:09:42:58:D0:47:30:ED:ED:9C:61:DB:BF:59:E5:90:0A:13:98:69:B6:61:B1:8F:B5:43:DD:2F:67:DE:91:A7',
    origin: 'android:apk-key-hash:yQlCWNBHMO3tnGHbv1nlkAoTmGm2YbGPtUPdL2fekac',
  },
];

describe('native app identity', () => {
  it.each(
    certificates,
  )('derives the unpadded base64url Android origin for $fingerprint', ({
    fingerprint,
    origin,
  }) => {
    expect(androidOrigin(fingerprint)).toBe(origin);
  });

  it('accepts the web, Apple and every Android origin together', () => {
    expect(
      acceptedOrigins('podcst.app', 'https://www.podcst.app').sort(),
    ).toEqual(
      [
        'https://www.podcst.app',
        'https://podcst.app',
        ...certificates.map(({ origin }) => origin),
      ].sort(),
    );
  });

  it('accepts the plain localhost origin for local development', () => {
    expect(acceptedOrigins('localhost', 'http://localhost:3000')).toContain(
      'http://localhost',
    );
  });

  it('grants Android sign-in credentials and app links to every certificate', () => {
    expect(assetLinks).toEqual([
      {
        relation: [
          'delegate_permission/common.get_login_creds',
          'delegate_permission/common.handle_all_urls',
        ],
        target: {
          namespace: 'android_app',
          package_name: 'app.podcst.android',
          sha256_cert_fingerprints: certificates.map(
            ({ fingerprint }) => fingerprint,
          ),
        },
      },
    ]);
  });

  it('opens canonical episode links in iOS and keeps web credentials', () => {
    expect(appleAppSiteAssociation).toEqual({
      applinks: {
        details: [
          {
            appIDs: ['DBD4H768ZS.app.podcst.ios'],
            components: [
              { '/': '/episodes/*%*', exclude: true },
              { '/': '/episodes/*/*/*', exclude: true },
              { '/': '/episodes/*' },
            ],
          },
        ],
      },
      webcredentials: { apps: ['DBD4H768ZS.app.podcst.ios'] },
    });
  });
});
