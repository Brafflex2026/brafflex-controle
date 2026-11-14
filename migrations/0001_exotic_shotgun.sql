CREATE TABLE `cliente` (
	`id` text PRIMARY KEY NOT NULL,
	`chave` text NOT NULL,
	`nome` text NOT NULL,
	`tipo` text NOT NULL,
	`profissao` text,
	`conselho` text,
	`registro_uf` text,
	`registro_numero` text,
	`rqe` text,
	`saude` text,
	`desde` text,
	`arquivado_em` text,
	`criado_em` text NOT NULL,
	`atualizado_em` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `cliente_chave_unique` ON `cliente` (`chave`);