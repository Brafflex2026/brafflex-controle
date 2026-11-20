-- Opt-out, conversão e retenção de leads.
ALTER TABLE `lead` ADD COLUMN `contato_apagado_em` text;
--> statement-breakpoint
-- Lista de quem pediu para sair: só o hash SHA-256 do telefone ou do Place ID, nunca o valor. Só de acréscimo.
CREATE TABLE `contato_bloqueado` (
	`hash` text PRIMARY KEY NOT NULL,
	`tipo` text NOT NULL CHECK (`tipo` IN ('telefone', 'place_id')),
	`criado_em` text NOT NULL
);
--> statement-breakpoint
CREATE TRIGGER `contato_bloqueado_sem_update` BEFORE UPDATE ON `contato_bloqueado`
BEGIN
	SELECT RAISE(ABORT, 'a lista de bloqueio é só de acréscimo: não se altera');
END;
--> statement-breakpoint
CREATE TRIGGER `contato_bloqueado_sem_delete` BEFORE DELETE ON `contato_bloqueado`
BEGIN
	SELECT RAISE(ABORT, 'a lista de bloqueio é só de acréscimo: não se apaga');
END;
--> statement-breakpoint
-- O histórico do lead continua só de acréscimo, com uma exceção: a coluna "nota" (texto livre, que pode citar a pessoa)
-- pode ser apagada, e só de lead que pediu para sair ou que já teve o contato apagado pela retenção.
DROP TRIGGER `lead_evento_sem_update`;
--> statement-breakpoint
CREATE TRIGGER `lead_evento_sem_update` BEFORE UPDATE ON `lead_evento`
WHEN NEW.id IS NOT OLD.id OR NEW.lead_id IS NOT OLD.lead_id OR NEW.ts IS NOT OLD.ts OR NEW.tipo IS NOT OLD.tipo
	OR NEW.de IS NOT OLD.de OR NEW.para IS NOT OLD.para OR NEW.canal IS NOT OLD.canal OR NEW.usuario IS NOT OLD.usuario
	OR NOT EXISTS (SELECT 1 FROM lead WHERE id = OLD.lead_id AND (opt_out_em IS NOT NULL OR contato_apagado_em IS NOT NULL))
BEGIN
	SELECT RAISE(ABORT, 'histórico do lead é só de acréscimo: só a nota de lead que saiu pode ser apagada');
END;
