import type { EmoteRoomsContent, PackContent } from '../app/plugins/custom-emoji/types';
import type { IRecentEmojiContent } from '../app/plugins/recent-emoji';
import type { InCinnySpacesContent } from '../app/hooks/useSidebarItems';
import type { PowerLevelTags } from '../app/hooks/usePowerLevelTags';
import type { RoomNamePrivateContent } from './matrix/accountData';

type RoomBannerContent = {
  url?: string;
};

// Registers the custom event types Cinny reads and writes with the SDK, whose
// account data and state helpers only accept the event types they know about.
declare module 'matrix-js-sdk/lib/@types/event' {
  interface StateEvents {
    'im.ponies.room_emotes': PackContent;
    'in.cinny.room.power_level_tags': PowerLevelTags;
    'page.codeberg.everypizza.room.banner': RoomBannerContent;
  }

  interface AccountDataEvents {
    'in.cinny.spaces': InCinnySpacesContent;
    'io.element.recent_emoji': IRecentEmojiContent;
    'im.ponies.user_emotes': PackContent;
    'im.ponies.emote_rooms': EmoteRoomsContent;
    'moe.sable.app.nicknames': Record<string, string>;
  }

  interface RoomAccountDataEvents {
    'de.gematik.msc4431.room.name.private': RoomNamePrivateContent;
  }
}
