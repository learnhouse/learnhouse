import AccountCreation from './account_creation'
import DefaultElements from './default_elements'
import DisableInstallMode from './disable_install_mode'
import Finish from './finish'
import GetStarted from './get_started'
import OrgCreation from './org_creation'
import SampleData from './sample_data'

export const INSTALL_STEPS = [
  {
    id: 'INSTALL_STATUS',
    name: 'Get started',
    component: <GetStarted />,
    completed: false,
  },
  {
    id: 'ORGANIZATION_CREATION',
    name: 'Organization Creation',
    component: <OrgCreation />,
    completed: false,
  },
  {
    id: 'DEFAULT_ELEMENTS',
    name: 'Default Elements',
    component: <DefaultElements />,
    completed: false,
  },
  {
    id: 'ACCOUNT_CREATION',
    name: 'Account Creation',
    component: <AccountCreation />,
    completed: false,
  },
  {
    id: 'SAMPLE_DATA',
    name: 'Sample Data',
    component: <SampleData />,
    completed: false,
  },
  {
    id: 'FINISH',
    name: 'Finish',
    component: <Finish />,
    completed: false,
  },
  {
    id: 'DISABLING_INSTALLATION_MODE',
    name: 'Disabling Installation Mode',
    component: <DisableInstallMode />,
    completed: false,
  },
]
