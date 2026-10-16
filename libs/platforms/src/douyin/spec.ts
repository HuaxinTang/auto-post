import type { PlatformSpec } from '../provider.interface';

export const DOUYIN_SPEC: PlatformSpec = {
  provider: 'DOUYIN',
  displayName: '抖音',
  authModes: ['BROWSER'],
  capabilities: {
    kinds: ['IMAGE_TEXT'],
    supportsDraft: true,
    visibility: ['PUBLIC', 'PRIVATE'],
    topics: true,
  },
  constraints: {
    title: { min: 10, max: 30 },
    body: { min: 100, max: 2200 },
    media: {
      min: 2,
      max: 35,
      mimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
      maxSizeMB: 50,
      animated: false,
      recommendedAspect: ['3:4', '4:3'],
    },
  },
  tasks: {
    login: 'douyin.login.qr',
    sessionCheck: 'douyin.session.check',
    publish: 'douyin.publish.image',
    confirmDraft: 'douyin.publish.confirm',
    listWorks: 'douyin.list.works',
  },
};

export const DOUYIN_PUBLISH_URL =
  'https://creator.douyin.com/creator-micro/content/upload?default-tab=3';
