import henri from './henri';
import Config from './config';

import './checks';

function reload() {
  delete henri.config;
  henri.config = new Config();
}

henri.addLoader(reload);
henri.log.info(`config module loaded.`);

// @ts-ignore
global['henri'] = henri;
