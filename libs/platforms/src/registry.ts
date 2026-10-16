import type { AuthMode, ProviderName, ProviderRegistry, SocialProvider } from './provider.interface';
import { DouyinBrowserProvider } from './douyin/douyin-browser.provider';

const providers: SocialProvider[] = [new DouyinBrowserProvider()];

export const providerRegistry: ProviderRegistry = {
  get(provider: ProviderName, authMode: AuthMode): SocialProvider {
    const found = providers.find((p) => p.spec.provider === provider && p.authMode === authMode);
    if (!found) {
      throw new Error(`provider not registered: ${provider}/${authMode}`);
    }
    return found;
  },
  list(): SocialProvider[] {
    return providers;
  },
};
