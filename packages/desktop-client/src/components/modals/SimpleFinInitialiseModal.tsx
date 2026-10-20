// @ts-strict-ignore
import React, { useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';

import { ButtonWithLoading } from '@actual-app/components/button';
import { Input } from '@actual-app/components/input';
import { Text } from '@actual-app/components/text';
import { View } from '@actual-app/components/view';
import { send } from '@actual-app/core/platform/client/connection';

import { Error } from '#components/alerts';
import { Link } from '#components/common/Link';
import {
  Modal,
  ModalButtons,
  ModalCloseButton,
  ModalHeader,
} from '#components/common/Modal';
import { FormField, FormLabel } from '#components/forms';
import type { Modal as ModalType } from '#modals/modalsSlice';
import { getSecretsError } from '#util/error';

type SimpleFinInitialiseModalProps = Extract<
  ModalType,
  { name: 'simplefin-init' }
>['options'];

export const SimpleFinInitialiseModal = ({
  onSuccess,
}: SimpleFinInitialiseModalProps) => {
  const { t } = useTranslation();
  const [token, setToken] = useState('');
  const [isValid, setIsValid] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(t('It is required to provide a token.'));

  const submit = async (close: () => void) => {
    if (!token.trim()) {
      setIsValid(false);
      return;
    }

    setIsLoading(true);

    const { error, reason } =
      (await send('secret-set', {
        name: 'simplefin_token',
        value: token,
      })) || {};

    if (error) {
      // Stay open so the error can be read and the token corrected
      setIsLoading(false);
      setIsValid(false);
      setError(getSecretsError(error, reason));
      return;
    }

    await send('secret-set', {
      name: 'simplefin_accessKey',
      value: null,
    });
    onSuccess();
    setIsLoading(false);
    close();
  };

  const onSubmit = async (close: () => void) => {
    try {
      await submit(close);
    } catch (e) {
      // A rejected request must not leave the form stuck in its loading state
      setIsLoading(false);
      setIsValid(false);
      setError(String((e as { message?: unknown })?.message ?? e));
    }
  };

  return (
    <Modal name="simplefin-init" containerProps={{ style: { width: 300 } }}>
      {({ state }) => (
        <>
          <ModalHeader
            title={t('Set-up SimpleFIN')}
            rightContent={<ModalCloseButton onPress={() => state.close()} />}
          />
          <View style={{ display: 'flex', gap: 10 }}>
            <Text>
              <Trans>
                In order to enable bank sync via SimpleFIN (only for North
                American banks), you will need to create a token. This can be
                done by creating an account with{' '}
                <Link
                  variant="external"
                  to="https://bridge.simplefin.org/"
                  linkColor="purple"
                >
                  SimpleFIN
                </Link>
                .
              </Trans>
            </Text>

            <FormField>
              <FormLabel title={t('Token:')} htmlFor="token-field" />
              <Input
                id="token-field"
                type="password"
                value={token}
                onChangeValue={value => {
                  setToken(value);
                  setIsValid(true);
                }}
              />
            </FormField>

            {!isValid && <Error>{error}</Error>}
          </View>

          <ModalButtons>
            <ButtonWithLoading
              variant="primary"
              autoFocus
              isLoading={isLoading}
              onPress={() => {
                void onSubmit(() => state.close());
              }}
            >
              <Trans>Save and continue</Trans>
            </ButtonWithLoading>
          </ModalButtons>
        </>
      )}
    </Modal>
  );
};
