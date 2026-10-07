// Chat « Poser une question » (page du cours ou séance en cours).

export interface ChatMessageDto {
  id: string;
  role: 'user' | 'assistant';
  contentMd: string;
  /** Photo jointe au message, s'il y en a une. */
  imageUrl: string | null;
  createdAt: number;
}

/** Conversation et ses messages. */
export interface ChatThreadDto {
  id: string;
  messages: ChatMessageDto[];
  /** Chat indisponible (EI en cours en mode examen). */
  disabled: boolean;
}
