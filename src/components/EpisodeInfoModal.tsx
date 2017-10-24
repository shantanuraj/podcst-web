/**
 * Episode info modal
 */

import { h } from 'preact';

import { style } from 'typestyle';

import EpisodeInfo, { IEpisodeInfoProps } from './EpisodeInfo';

const modalContainer = style({
  position: 'fixed',
  height: '100%',
  width: '100%',
  zIndex: 503,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'flex-end',
  transform: `translateY(100%)`,
  transition: 'all 0.5s ease',
  $nest: {
    '&[data-is-modal-visible]': {
      transform: `translateY(0px)`,
    },
  },
});

const modal = (theme: App.ITheme) =>
  style({
    position: 'relative',
    backgroundColor: theme.background,
    height: '80%',
    width: '100%',
    maxWidth: 600,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    overflowY: 'scroll',
  });

const closeBarContainer = (theme: App.ITheme) =>
  style({
    backgroundColor: theme.background,
    border: 0,
    width: '100%',
    padding: 16,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'fixed',
    bottom: 0,
    left: 0,
    right: 0,
    boxShadow: `0px -4px 16px 0px rgba(0,0,0,0.75)`,
    $nest: {
      '&:hover, &:focus': {
        outline: 0,
      },
    },
  });

const closeBar = (theme: App.ITheme) =>
  style({
    backgroundColor: theme.text,
    height: 4,
    width: '70%',
    borderRadius: 2,
  });

interface IEpisodeInfoModalProps extends IEpisodeInfoProps {
  isModalVisible: boolean;
  feed: never;
  title: never;
  closeModal: () => void;
}

const EpisodeInfoModal = (props: IEpisodeInfoModalProps) => {
  const { closeModal, currentEpisode, isModalVisible, theme } = props;
  const isVisible = !!currentEpisode && isModalVisible;
  return (
    <div data-is-modal-visible={isVisible} class={modalContainer}>
      <div class={modal(theme)}>
        <button aria-label="Close episode modal" role="button" class={closeBarContainer(theme)} onClick={closeModal}>
          <div class={closeBar(theme)} />
        </button>
        {isModalVisible && !!currentEpisode ? (
          <EpisodeInfo feed={currentEpisode.feed} title={currentEpisode.title} {...props} />
        ) : (
          <div />
        )}
      </div>
    </div>
  );
};

export default EpisodeInfoModal;
