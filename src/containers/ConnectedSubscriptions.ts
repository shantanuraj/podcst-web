/**
 * Connected Subscriptions component
 */

import { connect } from 'react-redux';

import { IState } from '../stores/root';

import { parseOPML } from '../stores/subscriptions';

import Subscriptions from '../components/Subscriptions';

const mapState = ({ app: { theme, mode }, subscriptions }: IState) => ({
  ...subscriptions,
  theme,
  themeMode: mode,
});

const mapDispatch = {
  parseOPML,
};

const ConnectedSubscriptions = connect(
  mapState,
  mapDispatch,
)(Subscriptions);

export default ConnectedSubscriptions;
