/**
 * Index redirect
 */

import { Component } from 'preact';

interface IndexRedirectProps {
  navigate: (route: string) => void;
}

class IndexRedirect extends Component<IndexRedirectProps, {}> {
  public componentDidMount() {
    this.props.navigate('/feed/top');
  }

  public render() {
    return null;
  }
}

export default IndexRedirect;
