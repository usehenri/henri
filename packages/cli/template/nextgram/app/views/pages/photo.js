import React from 'react';
import Photo from '../components/frame';

import stylesheet from 'styles/photo.scss';

export default ({ url: { query: { id } } }) =>
  <div className="permalink">
    <style dangerouslySetInnerHTML={{ __html: stylesheet }} />
    <div className="wrap">
      <Photo id={id} />
    </div>
  </div>;
