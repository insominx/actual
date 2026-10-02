import React from 'react';
import type { ComponentPropsWithoutRef, CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';

import { Menu } from '@actual-app/components/menu';
import { styles } from '@actual-app/components/styles';
import { theme } from '@actual-app/components/theme';

import { parseDisplayMode } from '#components/budget/expense-view/expenseData';
import { Modal, ModalCloseButton, ModalHeader } from '#components/common/Modal';
import { useLocalPref } from '#hooks/useLocalPref';
import type { Modal as ModalType } from '#modals/modalsSlice';

type BudgetPageMenuModalProps = Extract<
  ModalType,
  { name: 'budget-page-menu' }
>['options'];

export function BudgetPageMenuModal({
  onAddCategoryGroup,
  onToggleHiddenCategories,
  onSwitchBudgetFile,
}: BudgetPageMenuModalProps) {
  const defaultMenuItemStyle: CSSProperties = {
    ...styles.mobileMenuItem,
    color: theme.menuItemText,
    borderRadius: 0,
    borderTop: `1px solid ${theme.pillBorder}`,
  };

  return (
    <Modal name="budget-page-menu">
      {({ state }) => (
        <>
          <ModalHeader
            showLogo
            rightContent={<ModalCloseButton onPress={() => state.close()} />}
          />
          <BudgetPageMenu
            onClose={() => state.close()}
            getItemStyle={() => defaultMenuItemStyle}
            onAddCategoryGroup={onAddCategoryGroup}
            onToggleHiddenCategories={onToggleHiddenCategories}
            onSwitchBudgetFile={onSwitchBudgetFile}
          />
        </>
      )}
    </Modal>
  );
}

type BudgetPageMenuProps = Omit<
  ComponentPropsWithoutRef<typeof Menu>,
  'onMenuSelect' | 'items'
> & {
  onAddCategoryGroup: () => void;
  onToggleHiddenCategories: () => void;
  onSwitchBudgetFile: () => void;
  onClose: () => void;
};

function BudgetPageMenu({
  onClose,
  onAddCategoryGroup,
  onToggleHiddenCategories,
  onSwitchBudgetFile,
  ...props
}: BudgetPageMenuProps) {
  const [showHiddenCategories] = useLocalPref('budget.showHiddenCategories');
  const [displayModePref, setDisplayMode] = useLocalPref('budget.displayMode');
  const displayMode = parseDisplayMode(displayModePref);

  const onMenuSelect = (name: string) => {
    switch (name) {
      case 'toggle-display-mode':
        setDisplayMode(displayMode === 'expenses' ? 'budget' : 'expenses');
        onClose();
        break;
      case 'add-category-group':
        onAddCategoryGroup?.();
        break;
      // case 'edit-mode':
      //   onEditMode?.(true);
      //   break;
      case 'toggle-hidden-categories':
        onToggleHiddenCategories?.();
        break;
      case 'switch-budget-file':
        onSwitchBudgetFile?.();
        break;
      default:
        throw new Error(`Unrecognized menu item: ${name}`);
    }
  };
  const { t } = useTranslation();

  return (
    <Menu
      {...props}
      onMenuSelect={onMenuSelect}
      items={[
        {
          name: 'toggle-display-mode',
          text:
            displayMode === 'expenses' ? t('Show budget') : t('Show expenses'),
        },
        {
          name: 'add-category-group',
          text: t('Add category group'),
        },
        {
          name: 'toggle-hidden-categories',
          text: `${!showHiddenCategories ? t('Show hidden categories') : t('Hide hidden categories')}`,
        },
        {
          name: 'switch-budget-file',
          text: t('Switch budget file'),
        },
      ]}
    />
  );
}
