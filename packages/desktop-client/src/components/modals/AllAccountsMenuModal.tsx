import React from 'react';
import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';

import { Menu } from '@actual-app/components/menu';
import { styles } from '@actual-app/components/styles';
import { theme } from '@actual-app/components/theme';

import {
  Modal,
  ModalCloseButton,
  ModalHeader,
  ModalTitle,
} from '#components/common/Modal';
import { useSyncedPref } from '#hooks/useSyncedPref';
import type { Modal as ModalType } from '#modals/modalsSlice';

type AllAccountsMenuModalProps = Extract<
  ModalType,
  { name: 'all-accounts-menu' }
>['options'];

export function AllAccountsMenuModal({ onClose }: AllAccountsMenuModalProps) {
  const { t } = useTranslation();
  const [hideReconciled, setHideReconciled] = useSyncedPref(
    'hide-reconciled-all',
  );

  const defaultMenuItemStyle: CSSProperties = {
    ...styles.mobileMenuItem,
    color: theme.menuItemText,
    borderRadius: 0,
    borderTop: `1px solid ${theme.pillBorder}`,
  };

  return (
    <Modal name="all-accounts-menu" onClose={onClose}>
      {({ state }) => (
        <>
          <ModalHeader
            title={<ModalTitle title={t('All Accounts')} shrinkOnOverflow />}
            rightContent={<ModalCloseButton onPress={() => state.close()} />}
          />
          <Menu
            getItemStyle={() => defaultMenuItemStyle}
            onMenuSelect={name => {
              if (name === 'toggle-reconciled') {
                setHideReconciled(hideReconciled === 'true' ? 'false' : 'true');
              }
              state.close();
            }}
            items={[
              {
                name: 'toggle-reconciled',
                text:
                  hideReconciled !== 'true'
                    ? t('Hide reconciled transactions')
                    : t('Show reconciled transactions'),
              },
            ]}
          />
        </>
      )}
    </Modal>
  );
}
