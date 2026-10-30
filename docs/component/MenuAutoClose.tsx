'use client';

import { useEffect } from 'react';
import { useRouter } from 'waku';

// The header stays mounted across client navigations, so its popover has to be closed by hand.
export const MenuAutoClose = ({ id }: { id: string }) => {
  const { path } = useRouter();

  useEffect(() => {
    document.getElementById(id)?.hidePopover();
  }, [id, path]);

  return null;
};
