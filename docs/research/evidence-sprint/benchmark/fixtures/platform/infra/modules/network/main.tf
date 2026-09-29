terraform {
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 5.60" }
  }
}

resource "aws_vpc" "main" {
  cidr_block = var.cidr
  tags = { owner = "platform", cost-center = "infra" }
}
