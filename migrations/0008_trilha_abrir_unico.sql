-- A primeira linha (abrir) de uma demanda não pode aparecer em outra demanda: impede copiar a cadeia de uma para outra.
CREATE UNIQUE INDEX `trilha_evento_abrir_unico` ON `trilha_evento` (`hash`) WHERE `n` = 1;
