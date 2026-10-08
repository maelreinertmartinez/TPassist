// Page d'un PDF affichée en grand dans une fenêtre (partie de cours utile, grille des pages d'un document).
import { Modal } from './ui';

/** Page à afficher : URL de son rendu et titre de la fenêtre. */
export interface PageImage {
  url: string;
  label: string;
}

/** Fenêtre affichant une page ; fermée quand `page` est null. */
export function PageImageModal({ page, onClose }: { page: PageImage | null; onClose: () => void }) {
  return (
    <Modal open={Boolean(page)} onClose={onClose} title={page?.label ?? ''} wide>
      {page && <img src={page.url} alt={page.label} className="w-full rounded" />}
    </Modal>
  );
}
