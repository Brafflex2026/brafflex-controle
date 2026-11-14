CREATE TABLE `auditoria_app` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`ts` text NOT NULL,
	`usuario` text NOT NULL,
	`acao` text NOT NULL,
	`entidade` text NOT NULL,
	`entidade_id` text NOT NULL,
	`antes` text,
	`depois` text
);
--> statement-breakpoint
CREATE TABLE `usuario` (
	`email` text PRIMARY KEY NOT NULL,
	`nome` text NOT NULL,
	`papel` text NOT NULL,
	`criado_em` text NOT NULL
);
