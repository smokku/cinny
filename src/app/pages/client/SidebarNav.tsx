import React, { useRef } from 'react';
import classNames from 'classnames';
import { Scroll } from 'folds';

import {
  Sidebar,
  SidebarContent,
  SidebarStackSeparator,
  SidebarStack,
} from '../../components/sidebar';
import {
  DirectTab,
  HomeTab,
  SpaceTabs,
  InboxTab,
  ExploreTab,
  UserMenuTab,
  UnverifiedTab,
  SearchTab,
} from './sidebar';
import { CreateTab } from './sidebar/CreateTab';
import { darkTheme } from '../../../colors.css';
import { onDarkFontWeight } from '../../../config.css';
import { useSetting } from '../../state/hooks/settings';
import { settingsAtom } from '../../state/settings';

export function SidebarNav() {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [darkSidebar] = useSetting(settingsAtom, 'darkSidebar');

  return (
    <Sidebar className={darkSidebar ? classNames(darkTheme, onDarkFontWeight) : undefined}>
      <SidebarContent
        scrollable={
          <Scroll ref={scrollRef} variant="Background" size="0">
            <SidebarStack>
              <HomeTab />
              <DirectTab />
            </SidebarStack>
            <SpaceTabs scrollRef={scrollRef} />
            <SidebarStackSeparator />
            <SidebarStack>
              <ExploreTab />
              <CreateTab />
            </SidebarStack>
          </Scroll>
        }
        sticky={
          <>
            <SidebarStackSeparator />
            <SidebarStack>
              <SearchTab />
              <UnverifiedTab />
              <InboxTab />
              <UserMenuTab />
            </SidebarStack>
          </>
        }
      />
    </Sidebar>
  );
}
