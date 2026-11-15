-- A trilha só aceita acréscimo: o banco recusa alterar ou apagar um evento já gravado.
CREATE TRIGGER `trilha_evento_sem_update` BEFORE UPDATE ON `trilha_evento`
BEGIN
	SELECT RAISE(ABORT, 'trilha é só de acréscimo: não se altera');
END;
--> statement-breakpoint
CREATE TRIGGER `trilha_evento_sem_delete` BEFORE DELETE ON `trilha_evento`
BEGIN
	SELECT RAISE(ABORT, 'trilha é só de acréscimo: não se apaga');
END;
