'use client';
import React, { useState } from 'react'
import { useOrg } from '@components/Contexts/OrgContext';
import { useLHSession } from '@components/Contexts/LHSessionContext';
import useSWR, { mutate } from 'swr';
import { getProducts, deleteProduct, updateProduct } from '@services/payments/products';
import CreateProductForm from '@components/Dashboard/Payments/SubComponents/CreateProductForm';
import { Plus, Trash2, Pencil, DollarSign, Info } from 'lucide-react';
import Modal from '@components/StyledElements/Modal/Modal';
import ConfirmationModal from '@components/StyledElements/ConfirmationModal/ConfirmationModal';
import toast from 'react-hot-toast';
import Link from 'next/link';
import { getUriWithOrg } from '@services/config/config';

function PaymentsProductPage() {
    const org = useOrg() as any;
    const session = useLHSession() as any;
    const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
    const [editingProductId, setEditingProductId] = useState<string | null>(null);

    const { data: products, error } = useSWR(
        () => org && session ? [`/payments/${org.id}/products`, session.data?.tokens?.access_token] : null,
        ([url, token]) => getProducts(org.id, token)
    );

    const handleDeleteProduct = async (productId: string) => {
        try {
            await deleteProduct(org.id, productId, session.data?.tokens?.access_token);
            mutate([`/payments/${org.id}/products`, session.data?.tokens?.access_token]);
            toast.success('Product deleted successfully');
        } catch (error) {
            toast.error('Failed to delete product');
        }
    }

    if (error) return <div>Failed to load products</div>;
    if (!products) return <div>Loading...</div>;

    return (
        <div className="h-full w-full bg-[#f8f8f8]">
            <div className="pl-10 pr-10 mx-auto">
                <div className="flex justify-between items-center">
                    <h1 className="text-2xl font-bold">Products</h1>
                    <button
                        onClick={() => setIsCreateModalOpen(true)}
                        className="mb-4 flex items-center space-x-2 px-2 py-1.5 rounded-md bg-gradient-to-bl text-gray-800 font-medium from-gray-400/50 to-gray-200/80 border border-gray-600/10 shadow-gray-900/10 shadow-lg hover:from-gray-300/50 hover:to-gray-100/80 transition duration-300"
                    >
                        <Plus size={18} />
                        <span className="text-sm font-bold">Create New Product</span>
                    </button>
                </div>

                <Modal
                    isDialogOpen={isCreateModalOpen}
                    onOpenChange={setIsCreateModalOpen}
                    dialogTitle="Create New Product"
                    dialogDescription="Add a new product to your organization"
                    dialogContent={
                        <CreateProductForm onSuccess={() => setIsCreateModalOpen(false)} />
                    }
                />

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {products.data.map((product: any) => (
                        <div key={product.id} className="bg-white p-4 rounded-lg nice-shadow">
                            {editingProductId === product.id ? (
                                <EditProductForm
                                    product={product}
                                    onSuccess={() => setEditingProductId(null)}
                                    onCancel={() => setEditingProductId(null)}
                                />
                            ) : (
                                <div className="flex flex-col space-y-2">
                                    <div className="flex justify-between items-start">
                                        <h3 className="font-bold text-lg">{product.name}</h3>
                                        <div className="flex space-x-2">
                                            <button
                                                onClick={() => setEditingProductId(product.id)}
                                                className="text-blue-500 hover:text-blue-700"
                                            >
                                                <Pencil size={16} />
                                            </button>
                                            <ConfirmationModal
                                                confirmationButtonText="Delete Product"
                                                confirmationMessage="Are you sure you want to delete this product?"
                                                dialogTitle={`Delete ${product.name}?`}
                                                dialogTrigger={
                                                    <button className="text-red-500 hover:text-red-700">
                                                        <Trash2 size={16} />
                                                    </button>
                                                }
                                                functionToExecute={() => handleDeleteProduct(product.id)}
                                                status="warning"
                                            />
                                        </div>
                                    </div>
                                    <p className="text-gray-600">{product.description}</p>
                                    <p className="mt-2 font-semibold">${product.amount.toFixed(2)}</p>
                                    <p className="text-sm text-gray-500">{product.product_type}</p>
                                    {product.benefits && (
                                        <div className="mt-2">
                                            <h4 className="font-semibold text-sm">Benefits:</h4>
                                            <p className="text-sm text-gray-600">{product.benefits}</p>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    ))}
                </div>

                {products.data.length === 0 && (
                    <div className="flex mx-auto space-x-2 font-semibold mt-3 text-gray-600 items-center">
                        <Info size={20} />
                        <p>No products available. Create a new product to get started.</p>
                    </div>
                )}
            </div>
        </div>
    )
}

const EditProductForm = ({ product, onSuccess, onCancel }: { product: any, onSuccess: () => void, onCancel: () => void }) => {
    const [name, setName] = useState(product.name);
    const [description, setDescription] = useState(product.description);
    const [amount, setAmount] = useState(product.amount);
    const [benefits, setBenefits] = useState(product.benefits || '');
    const org = useOrg() as any;
    const session = useLHSession() as any;

    const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        try {
            await updateProduct(org.id, product.id, { name, description, amount, benefits }, session.data?.tokens?.access_token);
            mutate([`/payments/${org.id}/products`, session.data?.tokens?.access_token]);
            onSuccess();
            toast.success('Product updated successfully');
        } catch (error) {
            toast.error('Failed to update product');
        }
    };

    return (
        <form onSubmit={handleSubmit} className="space-y-4">
            <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full p-2 border rounded"
                placeholder="Product Name"
            />
            <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="w-full p-2 border rounded"
                placeholder="Product Description"
            />
            <input
                type="number"
                value={amount}
                onChange={(e) => setAmount(parseFloat(e.target.value))}
                className="w-full p-2 border rounded"
                placeholder="Price"
                step="0.01"
            />
            <textarea
                value={benefits}
                onChange={(e) => setBenefits(e.target.value)}
                className="w-full p-2 border rounded"
                placeholder="Product Benefits"
            />
            <div className="flex justify-end space-x-2">
                <button type="button" onClick={onCancel} className="px-4 py-2 text-gray-600 border rounded">Cancel</button>
                <button type="submit" className="px-4 py-2 text-white bg-blue-500 rounded">Save</button>
            </div>
        </form>
    );
};

export default PaymentsProductPage
