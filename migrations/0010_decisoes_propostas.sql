-- Decisões (DEC-NNN) e propostas (P-NNN): só acréscimo. Correção é uma nova decisão que aponta a antiga.
CREATE TABLE `decisao` (
	`id` text PRIMARY KEY NOT NULL,
	`chave` text,
	`data` text NOT NULL,
	`demanda_ref` text,
	`nivel` integer NOT NULL CHECK (`nivel` IN (2, 3)),
	`quem` text NOT NULL,
	`titulo` text NOT NULL,
	`decisao` text NOT NULL,
	`motivo` text,
	`como_desfazer` text,
	`observacoes` text,
	`corrige_id` text,
	`proposta_id` text,
	`origem` text NOT NULL CHECK (`origem` IN ('app', 'importada')),
	`criado_em` text NOT NULL,
	`criado_por` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `decisao_chave_unica` ON `decisao` (`chave`);
--> statement-breakpoint
CREATE INDEX `decisao_demanda_ref` ON `decisao` (`demanda_ref`);
--> statement-breakpoint
CREATE TABLE `proposta` (
	`id` text PRIMARY KEY NOT NULL,
	`chave` text,
	`titulo` text NOT NULL,
	`texto` text NOT NULL,
	`decisao_id` text,
	`origem` text NOT NULL CHECK (`origem` IN ('app', 'importada')),
	`criado_em` text NOT NULL,
	`criado_por` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `proposta_chave_unica` ON `proposta` (`chave`);
--> statement-breakpoint
-- Trava da importação única: a segunda tentativa falha por chave repetida e o lote inteiro é desfeito.
CREATE TABLE `importacao_unica` (
	`nome` text PRIMARY KEY NOT NULL,
	`feita_em` text NOT NULL
);
--> statement-breakpoint
CREATE TRIGGER `decisao_sem_update` BEFORE UPDATE ON `decisao`
BEGIN
	SELECT RAISE(ABORT, 'decisão é só de acréscimo: não se altera');
END;
--> statement-breakpoint
CREATE TRIGGER `decisao_sem_delete` BEFORE DELETE ON `decisao`
BEGIN
	SELECT RAISE(ABORT, 'decisão é só de acréscimo: não se apaga');
END;
--> statement-breakpoint
CREATE TRIGGER `proposta_sem_update` BEFORE UPDATE ON `proposta`
BEGIN
	SELECT RAISE(ABORT, 'proposta é só de acréscimo: não se altera');
END;
--> statement-breakpoint
CREATE TRIGGER `proposta_sem_delete` BEFORE DELETE ON `proposta`
BEGIN
	SELECT RAISE(ABORT, 'proposta é só de acréscimo: não se apaga');
END;
--> statement-breakpoint
CREATE TRIGGER `importacao_unica_sem_update` BEFORE UPDATE ON `importacao_unica`
BEGIN
	SELECT RAISE(ABORT, 'a trava da importação não se altera');
END;
--> statement-breakpoint
CREATE TRIGGER `importacao_unica_sem_delete` BEFORE DELETE ON `importacao_unica`
BEGIN
	SELECT RAISE(ABORT, 'a trava da importação não se apaga');
END;
