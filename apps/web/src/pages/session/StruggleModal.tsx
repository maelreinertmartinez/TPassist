// Fenêtre « As-tu galéré ? », ouverte quand l'étudiant passe une question sans avoir proposé de réponse.
import { Button, Modal } from '../../components/ui';
import type { SessionController } from './useSession';

/** La réponse alimente le quiz de révision et les points bloquants ; dans les deux cas, la question est passée. */
export function StruggleModal({ ctl }: { ctl: SessionController }) {
  const { close } = ctl;
  const cancel = () => ctl.setStruggleOpen(false);
  return (
    <Modal
      open={ctl.struggleOpen}
      onClose={cancel}
      title="As-tu galéré sur cette question ?"
      footer={
        <>
          <Button variant="tertiary" onClick={cancel}>
            Rester sur la question
          </Button>
          <Button onClick={() => close.mutate({ struggled: false, skip: true })} loading={close.isPending && close.variables?.struggled === false}>
            Non, ça allait
          </Button>
          <Button variant="primary" onClick={() => close.mutate({ struggled: true, skip: true })} loading={close.isPending && close.variables?.struggled === true}>
            Oui, j’ai galéré
          </Button>
        </>
      }
    >
      <p className="text-sm text-ink-2">Tu passes sans avoir proposé de réponse. Ta réponse sert à cibler le quiz de révision et tes points bloquants. La solution de cette question sera dans ton bilan de fin.</p>
    </Modal>
  );
}
