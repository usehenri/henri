import { Link, useHenri } from '@usehenri/inertia';
import Layout from 'components/layout';
import ProposalForm from 'components/proposal-form';
import { PageHeader } from 'components/ui';

export default function EditProposal() {
  const { data, getRoute, pathFor } = useHenri();
  const id = String(data.proposal.id);

  return (
    <Layout>
      <Link
        className="text-sm text-zinc-500 hover:underline dark:text-zinc-400"
        href={getRoute('show_proposals_path', id)}
      >
        &larr; Back to the proposal
      </Link>

      <div className="mt-3">
        <PageHeader
          title="Edit the draft"
          subtitle="A proposal can only be edited while it is a draft; after that, withdraw it and write a new one."
        />
      </div>

      <ProposalForm
        action={pathFor('update_proposals_path', { id })}
        events={data.events}
        method="patch"
        proposal={data.proposal}
        submit="Save"
        tracks={data.tracks}
      />
    </Layout>
  );
}
