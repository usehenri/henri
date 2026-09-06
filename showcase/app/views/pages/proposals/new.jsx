import { useHenri } from '@usehenri/inertia';
import Layout from 'components/layout';
import ProposalForm from 'components/proposal-form';
import { PageHeader } from 'components/ui';

export default function NewProposal() {
  const { data, pathFor } = useHenri();

  return (
    <Layout>
      <PageHeader
        title="Write a proposal"
        subtitle="It is saved as a draft first. You can keep editing it until you submit it to the committee."
      />
      <ProposalForm
        action={pathFor('create_proposals_path')}
        events={data.events}
        proposal={data.proposal}
        submit="Save the draft"
        tracks={data.tracks}
      />
    </Layout>
  );
}
