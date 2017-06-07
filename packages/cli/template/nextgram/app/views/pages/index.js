import React from 'react';
import Router from 'next/router';

import WithClient from 'components/henri';
import Modal from '../components/modal';

import stylesheet from 'styles/index.scss';

class Index extends React.Component {
  static url = '/index';
  constructor(props) {
    super(props);
    this.onKeyDown = this.onKeyDown.bind(this);
  }

  // handling escape close
  componentDidMount() {
    document.addEventListener('keydown', this.onKeyDown);
  }

  componentWillUnmount() {
    document.removeEventListener('keydown', this.onKeyDown);
  }

  onKeyDown(e) {
    if (!this.props.url.query.photoId) return;
    if (e.keyCode === 27) {
      this.props.url.back();
    }
  }

  dismissModal() {
    Router.push('/');
  }

  showPhoto(e, id) {
    e.preventDefault();
    Router.push(`/?photoId=${id}`, `/photo?id=${id}`);
  }

  render() {
    const { url, photos } = this.props;

    return (
      <div className="list">
        <style dangerouslySetInnerHTML={{ __html: stylesheet }} />
        {url.query.photoId &&
          <Modal
            id={url.query.photoId}
            onDismiss={() => this.dismissModal()}
          />}
        {photos.map(id =>
          <div key={id} className="photo">
            <a
              className="photoLink"
              href={`/photo?id=${id}`}
              onClick={e => this.showPhoto(e, id)}
            >
              {id}
            </a>
          </div>
        )}
      </div>
    );
  }
}

export default WithClient(Index);
