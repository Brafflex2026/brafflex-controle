-- A auditoria só aceita acréscimo: o banco recusa alterar ou apagar uma linha já gravada.
CREATE TRIGGER `auditoria_app_sem_update` BEFORE UPDATE ON `auditoria_app`
BEGIN
	SELECT RAISE(ABORT, 'auditoria é só de acréscimo: não se altera');
END;
--> statement-breakpoint
CREATE TRIGGER `auditoria_app_sem_delete` BEFORE DELETE ON `auditoria_app`
BEGIN
	SELECT RAISE(ABORT, 'auditoria é só de acréscimo: não se apaga');
END;
